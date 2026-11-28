import { LISTENING_MOD } from '@common/listening/types'
import { listeningSource, listeningUuid, record } from '@common/listening/validation'

import type { ModListeningFrame, ModListeningRoomResult, ModListeningSource } from '@common/listening/types'
import type { Socket } from 'socket.io'

export class ListeningModTransport {
    private readonly sockets = new Set<Socket>()
    private selected?: Socket
    source?: ModListeningSource
    onChange = () => {}
    onSource = () => {}
    onOpen = () => {}
    onLeave = async (_roomId: string): Promise<{ ok: boolean; error?: string }> => ({ ok: false, error: 'UNAVAILABLE' })
    onRoom = async (_roomId: string): Promise<ModListeningRoomResult> => ({ ok: false, error: 'UNAVAILABLE' })
    onApplied = (_commandId: string, _ok: boolean) => {}
    get ready(): boolean {
        return this.selected?.connected === true
    }

    register(socket: Socket): void {
        if (socket.data.modIntegrityVerified !== true) return
        const select = () => {
            const clients = [...this.sockets].filter(candidate => candidate.connected)
            const next = clients.length === 1 ? clients[0] : undefined
            if (this.selected !== next) {
                this.selected = next
                this.source = undefined
                this.onChange()
            }
        }
        socket.on(LISTENING_MOD.hello, (value: unknown) => {
            if (record(value).protocolVersion !== 1) return
            this.sockets.add(socket)
            select()
        })
        socket.on(LISTENING_MOD.source, (value: unknown) => {
            if (socket !== this.selected) return
            const source = listeningSource(value)
            if (source) {
                this.source = { ...source, capturedAtMs: Math.round(performance.now()) }
                this.onSource()
            }
        })
        socket.on(LISTENING_MOD.applied, (value: unknown) => {
            const result = record(value)
            if (socket !== this.selected || typeof result.commandId !== 'string' || typeof result.ok !== 'boolean') return
            const source = listeningSource(result.source)
            if (source) {
                this.source = { ...source, capturedAtMs: Math.round(performance.now()) }
                this.onSource()
            }
            this.onApplied(result.commandId, result.ok && Boolean(source))
        })
        socket.on(LISTENING_MOD.open, () => {
            if (socket === this.selected) this.onOpen()
        })
        socket.on(LISTENING_MOD.leave, (value: unknown, acknowledge: unknown) => {
            if (typeof acknowledge !== 'function') return
            const roomId = record(value).roomId
            if (socket !== this.selected || !listeningUuid(roomId)) return acknowledge({ ok: false, error: 'FORBIDDEN' })
            void this.onLeave(roomId)
                .then(result => acknowledge(result))
                .catch(() => acknowledge({ ok: false, error: 'UNAVAILABLE' }))
        })
        socket.on(LISTENING_MOD.room, (value: unknown, acknowledge: unknown) => {
            if (typeof acknowledge !== 'function') return
            const roomId = record(value).roomId
            if (socket !== this.selected || !listeningUuid(roomId)) return acknowledge({ ok: false, error: 'FORBIDDEN' })
            void this.onRoom(roomId)
                .then(result => acknowledge(result))
                .catch(() => acknowledge({ ok: false, error: 'UNAVAILABLE' }))
        })
        socket.once('disconnect', () => {
            this.sockets.delete(socket)
            select()
        })
    }
    send(frame: ModListeningFrame): void {
        this.selected?.emit(LISTENING_MOD.frame, frame)
    }
    disable(): void {
        for (const socket of this.sockets)
            socket.emit(LISTENING_MOD.frame, {
                protocolVersion: 1,
                enabled: false,
                role: null,
                roomId: null,
                epoch: 0,
                revision: 0,
                validForMs: 0,
                target: null,
                command: null,
                queue: [],
            })
    }
}
