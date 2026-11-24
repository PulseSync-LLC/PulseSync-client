import { randomUUID } from 'node:crypto'

import { LISTENING_IPC } from '@common/listening/types'
import { listeningAction, listeningOperation, listeningUuid, record } from '@common/listening/validation'

import { ListeningConnection } from './connection'
import { HostSource } from './hostSource'
import { ListeningModTransport } from './modTransport'
import { projectListeningFrame } from './projection'
import { performRoomOperation } from './roomOperations'

import type { ListeningAccess } from './access'
import type { ListeningView, ModListeningFrame } from '@common/listening/types'
import type { BrowserWindow } from 'electron'

const disabledView = (): ListeningView => ({ available: false, connection: 'idle', userId: null, room: null, modReady: false, error: null })
export class ListeningController {
    readonly mod = new ListeningModTransport()
    private readonly host = new HostSource()
    private readonly connection = new ListeningConnection(
        () => this.ticket(),
        () => this.publish(),
        reason => this.disconnected(reason),
        value => this.command(value),
    )
    private view = disabledView()
    private window?: BrowserWindow
    private enabled = false
    private generation = 0
    private identity = ''
    private url = ''
    private socketPath = '/ws'
    private tick?: NodeJS.Timeout
    private reconnect?: NodeJS.Timeout
    private lastConfiguration = 0
    private configuring?: Promise<void>
    private connecting?: Promise<void>
    private busy = false
    private reconnectDelay = 1000
    private disconnectedAt = 0
    private participantAt = 0
    private participantSeq = 0
    private pendingCommand: ModListeningFrame['command'] = null

    constructor(private readonly access: ListeningAccess) {
        this.mod.onChange = () => {
            this.publish()
            this.frame()
        }
        this.mod.onApplied = (id, ok) => {
            if (id !== this.pendingCommand?.commandId) return
            this.host.commandApplied(id, ok)
            this.pendingCommand = null
            if (!ok) this.view.error = 'PLAYBACK_FAILED'
            this.publish()
        }
        this.mod.onOpen = () => {
            if (!this.view.available || !this.window || this.window.isDestroyed()) return
            this.window.show()
            this.window.focus()
            this.window.webContents.send(LISTENING_IPC.changed, { ...this.snapshot(), open: true })
        }
    }
    bindWindow(window: BrowserWindow): void {
        this.window = window
    }
    snapshot(): ListeningView {
        return { ...this.view, userId: this.connection.userId, room: this.connection.room, modReady: this.mod.ready }
    }
    async start(): Promise<ListeningView> {
        const generation = this.generation
        await this.access.initialize()
        if (generation !== this.generation) throw new Error('CANCELLED')
        if (!this.enabled) {
            this.enabled = true
            this.identity = this.access.sessionId()
            this.tick = setInterval(() => this.pulse(), 1000)
            this.tick.unref()
        }
        await this.configure()
        return this.snapshot()
    }
    private async configure(): Promise<void> {
        if (this.configuring) return this.configuring
        if (!this.enabled || Date.now() - this.lastConfiguration < 30000) return
        const generation = this.generation
        const pending = (async () => {
            try {
                const configuration = await this.access.configuration()
                if (generation !== this.generation || !this.enabled) return
                if (configuration.enabled !== true || typeof configuration.serverUrl !== 'string') throw new Error('EXPERIMENT_DISABLED')
                const url = new URL(configuration.serverUrl)
                const socketPath = configuration.socketPath ?? '/ws'
                if (typeof socketPath !== 'string' || socketPath.length > 128 || !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/u.test(socketPath))
                    throw new Error('CONFIGURATION_INVALID')
                const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
                if (
                    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
                    url.username ||
                    url.password ||
                    url.pathname !== '/' ||
                    url.search ||
                    url.hash
                )
                    throw new Error('CONFIGURATION_INVALID')
                if (this.url && (this.url !== url.origin || this.socketPath !== socketPath)) this.clearRoom()
                this.url = url.origin
                this.socketPath = socketPath
                this.view.available = true
            } catch {
                if (generation !== this.generation) return
                this.clearRoom()
                this.view.available = false
            } finally {
                if (generation === this.generation) {
                    this.lastConfiguration = Date.now()
                    this.publish()
                    this.frame()
                }
            }
        })()
        this.configuring = pending
        try {
            await pending
        } finally {
            if (this.configuring === pending) this.configuring = undefined
        }
    }
    private async ticket() {
        const generation = this.generation
        if (!this.enabled) throw new Error('ACCESS_UNAVAILABLE')
        const ticket = await this.access.ticket(this.identity)
        if (generation !== this.generation || !this.enabled) throw new Error('CANCELLED')
        return ticket
    }
    private async connect(): Promise<void> {
        if (this.connection.connected) return
        if (this.connecting) return this.connecting
        const generation = this.generation
        const work = (async () => {
            await this.configure()
            if (!this.enabled || !this.view.available) throw new Error('FEATURE_UNAVAILABLE')
            this.view.connection = this.connection.room ? 'reconnecting' : 'connecting'
            this.publish()
            await this.connection.connect(this.url, this.socketPath)
            if (generation !== this.generation) throw new Error('CANCELLED')
            const room = this.connection.room
            if (room) {
                try {
                    const resumed = record(
                        await this.connection.request(
                            'room:resume',
                            { roomId: room.roomId, commandId: randomUUID(), lastSeenRevision: room.revision },
                            true,
                        ),
                    )
                    this.connection.accept(resumed.snapshot)
                } catch (error) {
                    if (error instanceof Error && ['FORBIDDEN', 'NOT_FOUND', 'ROOM_CLOSED', 'ACCESS_REVOKED'].includes(error.message))
                        this.clearRoom()
                    throw error
                }
            }
            this.reconnectDelay = 1000
            this.view.connection = 'connected'
            this.view.error = null
            this.disconnectedAt = 0
            this.host.reset()
            this.participantSeq = 0
            this.publish()
            this.frame()
        })()
        this.connecting = work
        try {
            await work
        } finally {
            if (this.connecting === work) this.connecting = undefined
        }
    }
    async run(input: unknown): Promise<{ ok: boolean; error?: string; invitation?: string }> {
        if (this.busy) return { ok: false, error: 'BUSY' }
        this.busy = true
        try {
            const operation = listeningOperation(input)
            await this.start()
            await this.connect()
            if (!this.mod.ready && ['create', 'join', 'control'].includes(operation.type)) throw new Error('MOD_UNAVAILABLE')
            const result = await performRoomOperation(this.connection, this.host, operation, () => this.clearRoom())
            if (operation.type === 'create' || operation.type === 'join') this.participantSeq = 0
            this.view.error = null
            this.publish()
            this.frame()
            return result
        } catch (error) {
            const code = error instanceof Error && /^[A-Z_]{1,40}$/u.test(error.message) ? error.message : 'UNAVAILABLE'
            this.view.error = code
            if (!this.connection.connected) this.view.connection = this.connection.room ? 'reconnecting' : 'idle'
            this.publish()
            return { ok: false, error: code }
        } finally {
            this.busy = false
        }
    }
    private command(value: unknown): void {
        const command = record(value),
            room = this.connection.room
        if (
            !room ||
            room.hostUserId !== this.connection.userId ||
            command.roomId !== room.roomId ||
            command.epoch !== room.epoch ||
            command.controllerId !== room.controller?.controllerId ||
            command.acceptedRevision !== room.revision ||
            !listeningUuid(command.commandId) ||
            !listeningAction(command.action)
        )
            return
        const itemId = command.action.type === 'selectItem' ? command.action.itemId : room.queue.currentItemId
        this.host.expectCommand(room, command.commandId, itemId ?? null)
        this.pendingCommand = { commandId: command.commandId, action: command.action, item: room.queue.items.find(item => item.itemId === itemId) }
        this.frame()
    }
    private pulse(): void {
        if (!this.enabled) return
        if (!this.identity || this.identity !== this.access.sessionId()) {
            this.stop()
            return
        }
        void this.configure()
        if (this.connection.connected && this.mod.source) void this.host.report(this.connection, this.mod.source)
        const frame = this.frame()
        const room = this.connection.room
        if (!room || !this.connection.connected || room.hostUserId === this.connection.userId || Date.now() - this.participantAt < 5500) return
        this.participantAt = Date.now()
        const fresh = this.mod.source && Date.now() - this.mod.source.capturedAtMs < 3000
        void this.connection
            .request('room:participant:report', {
                roomId: room.roomId,
                reportSeq: ++this.participantSeq,
                observedRevision: room.revision,
                status:
                    !fresh || this.mod.source!.reason
                        ? 'unavailable'
                        : !frame.target
                          ? 'suspended'
                          : this.mod.source!.status === 'buffering'
                            ? 'buffering'
                            : 'following',
                reason: !fresh ? 'client_unavailable' : (this.mod.source!.reason ?? (frame.target ? null : 'client_unavailable')),
            })
            .catch(() => this.connection.refresh())
    }
    private frame(): ModListeningFrame {
        const frame = projectListeningFrame(this.connection, this.view.available, this.disconnectedAt, this.pendingCommand)
        this.mod.send(frame)
        return frame
    }
    private disconnected(reason: string): void {
        if (!this.enabled) return
        if (reason === 'ACCESS_REVOKED') {
            this.stop()
            this.view.error = reason
            this.publish()
            return
        }
        if (!this.connection.room) {
            this.view.connection = 'idle'
            this.view.error = reason
            this.publish()
            this.frame()
            return
        }
        this.view.connection = 'reconnecting'
        this.view.error = reason
        this.disconnectedAt ||= Date.now()
        this.publish()
        this.frame()
        clearTimeout(this.reconnect)
        this.reconnect = setTimeout(() => {
            if (this.enabled && this.connection.room) void this.connect().catch(() => this.disconnected(reason))
        }, this.reconnectDelay)
        this.reconnectDelay = Math.min(15000, this.reconnectDelay * 2)
        this.reconnect.unref()
    }
    private clearRoom(): void {
        this.connection.close()
        this.connection.room = null
        this.host.reset()
        this.pendingCommand = null
        this.view.connection = 'idle'
        this.disconnectedAt = 0
        clearTimeout(this.reconnect)
    }
    stop(): void {
        this.enabled = false
        this.generation++
        clearInterval(this.tick)
        this.clearRoom()
        this.connection.userId = null
        this.identity = ''
        this.lastConfiguration = 0
        this.view = disabledView()
        this.mod.disable()
        this.publish()
    }
    private publish(): void {
        if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed())
            this.window.webContents.send(LISTENING_IPC.changed, this.snapshot())
    }
}
