import { randomUUID } from 'node:crypto'

import { LISTENING_IPC } from '@common/listening/types'
import { listeningAction, listeningOperation, listeningUuid, record } from '@common/listening/validation'

import { ensureRendererLoaded } from '../rendererMemory'
import { ListeningConnection } from './connection'
import { HostSource } from './hostSource'
import { ListeningModTransport } from './modTransport'
import { projectListeningFrame } from './projection'
import { performRoomOperation } from './roomOperations'

import type { ListeningAccess } from './access'
import type { ListeningView, ModListeningFrame } from '@common/listening/types'
import type { BrowserWindow } from 'electron'

const disabledView = (): ListeningView => ({
    available: false,
    connection: 'idle',
    userId: null,
    room: null,
    modReady: false,
    error: null,
})
const diagnosticFields = [
    'rttMs',
    'clockUncertaintyMs',
    'snapshotAgeMs',
    'sourceAgeMs',
    'reconnectAttempt',
    'retryInMs',
    'lastDisconnectReason',
    'sourceError',
    'synchronization',
] as const
export class ListeningController {
    readonly mod = new ListeningModTransport()
    private readonly host = new HostSource()
    private readonly connection = new ListeningConnection(
        () => this.ticket(),
        () => {
            if (this.connection.room) this.rememberParticipation(this.connection.room.status !== 'closed')
            this.publish()
            this.frame()
        },
        reason => this.disconnected(reason),
        value => this.command(value),
    )
    private view = disabledView()
    private window?: BrowserWindow
    private enabled = false
    private resume = false
    private generation = 0
    private identity = ''
    private url = ''
    private socketPath = '/ws'
    private tick?: NodeJS.Timeout
    private reconnect?: NodeJS.Timeout
    private configurationDueAt = -Infinity
    private configuring?: Promise<void>
    private connecting?: Promise<void>
    private busy = false
    private reconnectDelay = 1000
    private reconnectAttempt = 0
    private retryAt = 0
    private lastDisconnectReason: string | null = null
    private published?: ListeningView
    private disconnectedAt = 0
    private participantAt = -Infinity
    private participantSeq = 0
    private participantState = ''
    private participantWork: object | null = null
    private participantTokens = 2
    private participantTokenAt = performance.now()
    private pendingCommand: ModListeningFrame['command'] = null

    constructor(private readonly access: ListeningAccess) {
        this.mod.onChange = () => {
            this.publish()
            this.frame()
        }
        this.mod.onSource = () => {
            if (this.enabled) this.pulse()
        }
        this.mod.onApplied = (id, ok) => {
            if (id !== this.pendingCommand?.commandId) return
            this.host.commandApplied(id, ok)
            this.mod.onSource()
            this.pendingCommand = null
            if (!ok) this.view.error = 'PLAYBACK_FAILED'
            this.publish()
        }
        this.mod.onOpen = () => {
            if (!this.view.available || !this.window || this.window.isDestroyed()) return
            void ensureRendererLoaded('#/joint')
                .then(() => {
                    if (!this.window || this.window.isDestroyed()) return
                    this.window.show()
                    this.window.focus()
                    this.window.webContents.send(LISTENING_IPC.changed, { ...this.snapshot(), open: true })
                })
                .catch(() => {})
        }
    }
    bindWindow(window: BrowserWindow): void {
        this.window = window
        this.published = undefined
    }
    snapshot(): ListeningView {
        return {
            ...this.view,
            userId: this.connection.userId,
            room: this.connection.room,
            modReady: this.mod.ready,
            moderationAvailable: this.connection.moderation,
            diagnostics: {
                ...this.connection.diagnostics,
                sourceAgeMs: this.mod.source ? Math.round(performance.now() - this.mod.source.capturedAtMs) : null,
                reconnectAttempt: this.reconnectAttempt,
                retryInMs: this.retryAt ? Math.max(0, Math.ceil((this.retryAt - performance.now()) / 1000) * 1000) : null,
                lastDisconnectReason: this.lastDisconnectReason,
                sourceError: this.host.error,
                synchronization:
                    this.connection.room && this.mod.source && performance.now() - this.mod.source.capturedAtMs < 3000
                        ? (this.mod.source.synchronization ?? null)
                        : null,
            },
        }
    }
    async start(forOperation = false): Promise<ListeningView> {
        const generation = this.generation
        await this.access.initialize()
        if (generation !== this.generation) throw new Error('CANCELLED')
        if (!this.enabled) {
            this.enabled = true
            this.identity = this.access.sessionId()
            this.resume = this.access.shouldResume()
            this.tick = setInterval(() => this.pulse(), 1000)
            this.tick.unref()
        }
        if (!this.connection.connected && !this.connecting) this.configurationDueAt = -Infinity
        await this.configure()
        if (generation !== this.generation || !this.enabled) throw new Error('CANCELLED')
        if (forOperation || this.resume || this.connection.room) {
            clearTimeout(this.reconnect)
            this.retryAt = 0
            await this.connect().catch(() => {})
        }
        if (!forOperation && !this.busy && !this.connection.room && !this.resume) this.idle()
        return this.snapshot()
    }
    private async configure(): Promise<void> {
        if (this.configuring) return this.configuring
        if (!this.enabled || performance.now() < this.configurationDueAt) return
        const generation = this.generation
        const pending = (async () => {
            let transient = false
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
                if (this.connection.connected && this.view.connection === 'connected' && this.view.error === 'ACCESS_UNAVAILABLE')
                    this.view.error = null
            } catch (error) {
                if (generation !== this.generation) return
                if (error instanceof Error && error.message === 'ACCESS_UNAVAILABLE') {
                    transient = true
                    this.view.error = 'ACCESS_UNAVAILABLE'
                    if (!this.url) this.view.available = true
                } else {
                    this.rememberParticipation(false)
                    this.clearRoom()
                    this.view.available = false
                }
            } finally {
                if (generation === this.generation) {
                    this.configurationDueAt = performance.now() + (transient ? 5000 : 30000)
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
        if (this.connecting) return this.connecting
        if (this.connection.connected && this.view.connection === 'connected') return
        const generation = this.generation
        const work = (async () => {
            await this.configure()
            if (generation !== this.generation || !this.enabled) throw new Error('CANCELLED')
            if (!this.view.available) throw new Error('FEATURE_UNAVAILABLE')
            if (!this.url) throw new Error('ACCESS_UNAVAILABLE')
            clearTimeout(this.reconnect)
            this.retryAt = 0
            this.view.connection = this.connection.room || this.reconnectAttempt ? 'reconnecting' : 'connecting'
            this.publish()
            await this.connection.connect(this.url, this.socketPath)
            if (generation !== this.generation) throw new Error('CANCELLED')
            const room = this.connection.room
            const roomId = room?.roomId ?? this.connection.resumableRoomId
            if (roomId) {
                try {
                    const resumed = record(
                        await this.connection.request(
                            'room:resume',
                            {
                                roomId,
                                commandId: randomUUID(),
                                lastSeenRevision: room?.revision ?? 0,
                            },
                            true,
                        ),
                    )
                    this.connection.accept(resumed.snapshot, true)
                } catch (error) {
                    if (error instanceof Error && ['FORBIDDEN', 'ROOM_NOT_FOUND', 'ROOM_CLOSED'].includes(error.message)) {
                        this.connection.room = null
                        this.connection.resumableRoomId = null
                        this.rememberParticipation(false)
                        this.view.error = 'ROOM_ENDED'
                    } else throw error
                }
            }
            if (generation !== this.generation || !this.connection.connected) throw new Error('CANCELLED')
            if (!this.connection.room) this.rememberParticipation(false)
            this.reconnectDelay = 1000
            this.reconnectAttempt = 0
            clearTimeout(this.reconnect)
            this.retryAt = 0
            this.view.connection = 'connected'
            if (this.view.error !== 'ROOM_ENDED') this.view.error = null
            this.disconnectedAt = 0
            this.host.reset()
            this.participantSeq = 0
            this.participantAt = -Infinity
            this.participantState = ''
            this.participantWork = null
            if (!this.connection.room && !this.busy) this.idle()
            this.publish()
            this.frame()
        })()
        this.connecting = work
        try {
            await work
        } catch (error) {
            if (generation === this.generation && this.enabled && !(error instanceof Error && error.message === 'CANCELLED'))
                this.disconnected(error instanceof Error ? error.message : 'CONNECTION_FAILED')
            throw error
        } finally {
            if (this.connecting === work) this.connecting = undefined
        }
    }
    async run(input: unknown): Promise<{ ok: boolean; error?: string; invitation?: string }> {
        if (this.busy) return { ok: false, error: 'BUSY' }
        this.busy = true
        const generation = this.generation
        let participationAttempted = false
        try {
            const operation = listeningOperation(input)
            if (!this.mod.ready && ['create', 'join', 'control'].includes(operation.type)) throw new Error('MOD_UNAVAILABLE')
            await this.start(true)
            if (!this.connection.connected || this.view.connection !== 'connected') throw new Error(this.view.error ?? 'NOT_CONNECTED')
            // An interrupted acknowledgement may hide a committed create/join. Resume discovers membership on the service.
            if (operation.type === 'create' || operation.type === 'join') {
                participationAttempted = true
                this.rememberParticipation(true)
            }
            const result = await performRoomOperation(this.connection, this.host, operation, () => this.idle())
            if (operation.type === 'create' || operation.type === 'join') this.participantSeq = 0
            this.view.error = null
            this.publish()
            this.frame()
            return result
        } catch (error) {
            if (generation !== this.generation) return { ok: false, error: 'CANCELLED' }
            const code = error instanceof Error && /^[A-Z_]{1,40}$/u.test(error.message) ? error.message : 'UNAVAILABLE'
            if (participationAttempted && !this.connection.room) {
                if (['ACK_TIMEOUT', 'CONNECTION_LOST', 'CANCELLED', 'SERVICE_UNAVAILABLE'].includes(code)) this.disconnected(code)
                else this.rememberParticipation(false)
            }
            this.view.error = code
            if (!this.connection.connected) this.view.connection = this.connection.room ? 'reconnecting' : 'idle'
            this.publish()
            return { ok: false, error: code }
        } finally {
            this.busy = false
            if (generation === this.generation && !this.connection.room && !this.resume) {
                this.idle()
                this.publish()
                this.frame()
            }
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
        this.pendingCommand = {
            commandId: command.commandId,
            action: command.action,
            item: room.queue.items.find(item => item.itemId === itemId),
        }
        this.frame()
    }
    private pulse(): void {
        if (!this.enabled) return
        if (!this.identity || this.identity !== this.access.sessionId()) {
            this.stop()
            return
        }
        if (this.connection.connected || this.connection.room || this.resume || this.connecting) void this.configure()
        const connected = this.connection.connected && this.view.connection === 'connected'
        if (connected && this.mod.source) void this.host.report(this.connection, this.mod.source)
        const frame = this.frame()
        this.publish()
        const room = this.connection.room
        if (!room || !connected || this.participantWork) return
        const fresh = this.mod.source && performance.now() - this.mod.source.capturedAtMs < 3000
        const following = frame.role === 'host' ? Boolean(this.connection.clock) : Boolean(frame.target && frame.target.status !== 'buffering')
        const status =
            !fresh || this.mod.source!.reason
                ? 'unavailable'
                : !following
                  ? 'suspended'
                  : this.mod.source!.status === 'buffering' || this.mod.source!.synchronization === 'preparing'
                    ? 'buffering'
                    : 'following'
        const reason = !fresh ? 'client_unavailable' : (this.mod.source!.reason ?? null)
        const participantState = JSON.stringify([status, reason])
        const now = performance.now()
        if (participantState === this.participantState && now - this.participantAt < 30000) return
        this.participantTokens = Math.min(2, this.participantTokens + Math.max(0, now - this.participantTokenAt) / 5000)
        this.participantTokenAt = now
        if (this.participantTokens < 1) return
        this.participantTokens--
        this.participantAt = now
        const participantWork = {}
        this.participantWork = participantWork
        const generation = this.generation
        void this.connection
            .request('room:participant:report', {
                roomId: room.roomId,
                reportSeq: ++this.participantSeq,
                observedRevision: room.revision,
                status,
                reason,
            })
            .then(() => {
                if (generation === this.generation && this.participantWork === participantWork) this.participantState = participantState
            })
            .catch(error => {
                if (generation !== this.generation || this.participantWork !== participantWork) return
                if (error instanceof Error && error.message === 'RATE_LIMITED') {
                    this.participantTokens = 0
                    this.participantTokenAt = performance.now()
                } else if (connected) this.connection.refresh()
            })
            .finally(() => {
                if (this.participantWork === participantWork) this.participantWork = null
            })
    }
    private frame(): ModListeningFrame {
        const frame = projectListeningFrame(
            {
                room: this.connection.room,
                userId: this.connection.userId,
                clock: this.connection.clock,
                connected: this.connection.connected && this.view.connection === 'connected',
            },
            this.view.available,
            this.disconnectedAt,
            this.pendingCommand,
        )
        this.mod.send(frame)
        return frame
    }
    private disconnected(reason: string): void {
        if (!this.enabled) return
        if (['ACCESS_REVOKED', 'AUTH_CHANGED', 'AUTH_INVALID'].includes(reason)) {
            this.rememberParticipation(false)
            this.stop()
            this.view.error = reason
            this.publish()
            return
        }
        if (reason === 'ROOM_ENDED' || reason === 'ROOM_REMOVED') {
            this.rememberParticipation(false)
            if (this.busy) this.clearRoom(false)
            else this.idle()
            this.view.error = reason
            this.publish()
            this.frame()
            return
        }
        if (!this.connection.room && !this.resume) {
            this.idle()
            this.view.error = reason
            this.publish()
            this.frame()
            return
        }
        this.connection.close()
        this.host.reset()
        this.pendingCommand = null
        this.lastDisconnectReason = reason
        if (['FEATURE_UNAVAILABLE', 'PROTOCOL_INVALID', 'PROTOCOL_UNSUPPORTED', 'CONFIGURATION_INVALID'].includes(reason)) {
            clearTimeout(this.reconnect)
            this.retryAt = 0
            this.view.connection = 'idle'
            this.view.error = reason
            this.publish()
            this.frame()
            return
        }
        this.view.connection = 'reconnecting'
        this.view.error = reason
        this.disconnectedAt ||= performance.now()
        this.publish()
        this.frame()
        if (this.retryAt) return
        this.reconnectAttempt++
        const delay = Math.round(this.reconnectDelay * (0.8 + Math.random() * 0.4))
        this.retryAt = performance.now() + delay
        this.reconnect = setTimeout(() => {
            this.retryAt = 0
            if (this.enabled) void this.connect().catch(() => {})
        }, delay)
        this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2)
        this.reconnect.unref()
    }
    private clearRoom(disconnect = true): void {
        if (disconnect) this.connection.close()
        this.connection.room = null
        this.connection.resumableRoomId = null
        this.host.reset()
        this.pendingCommand = null
        this.view.connection = this.connection.connected ? 'connected' : 'idle'
        this.disconnectedAt = 0
        this.participantAt = -Infinity
        this.participantState = ''
        this.participantWork = null
        this.participantTokens = 2
        this.participantTokenAt = performance.now()
        this.retryAt = 0
        this.reconnectAttempt = 0
        this.reconnectDelay = 1000
        clearTimeout(this.reconnect)
    }
    private rememberParticipation(active: boolean): void {
        this.resume = active
        this.access.rememberParticipation(active)
    }
    private idle(): void {
        this.rememberParticipation(false)
        this.clearRoom()
    }
    stop(): void {
        this.enabled = false
        this.resume = false
        this.generation++
        this.connecting = undefined
        this.configuring = undefined
        clearInterval(this.tick)
        this.clearRoom()
        this.connection.userId = null
        this.identity = ''
        this.url = ''
        this.socketPath = '/ws'
        this.configurationDueAt = -Infinity
        this.lastDisconnectReason = null
        this.view = disabledView()
        this.mod.disable()
        this.publish()
    }
    private publish(): void {
        if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
        const snapshot = this.snapshot()
        if (snapshot.diagnostics) {
            for (const key of ['snapshotAgeMs', 'sourceAgeMs'] as const) {
                const age = snapshot.diagnostics[key]
                snapshot.diagnostics[key] = age === null ? null : Math.floor(age / 1000) * 1000
            }
        }
        const previous = this.published
        if (
            previous &&
            previous.available === snapshot.available &&
            previous.connection === snapshot.connection &&
            previous.userId === snapshot.userId &&
            previous.room === snapshot.room &&
            previous.modReady === snapshot.modReady &&
            previous.error === snapshot.error &&
            previous.moderationAvailable === snapshot.moderationAvailable &&
            diagnosticFields.every(key => previous.diagnostics?.[key] === snapshot.diagnostics?.[key])
        )
            return
        this.published = snapshot
        this.window.webContents.send(LISTENING_IPC.changed, snapshot)
    }
}
