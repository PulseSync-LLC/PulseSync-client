import { LISTENING_MOD } from '@common/listening/types'
import { listeningSource, record } from '@common/listening/validation'

import type { ModListeningFrame, ModListeningSource } from '@common/listening/types'
import type { Socket } from 'socket.io'

export class ListeningModTransport {
    private readonly sockets = new Set<Socket>()
    private selected?: Socket
    source?: ModListeningSource
    onChange = () => {}
    onOpen = () => {}
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
            if (source && Math.abs(Date.now() - source.capturedAtMs) < 5000) this.source = source
        })
        socket.on(LISTENING_MOD.applied, (value: unknown) => {
            const result = record(value)
            if (socket !== this.selected || typeof result.commandId !== 'string' || typeof result.ok !== 'boolean') return
            const source = listeningSource(result.source)
            if (source && Math.abs(Date.now() - source.capturedAtMs) < 5000) this.source = source
            this.onApplied(result.commandId, result.ok && Boolean(source))
        })
        socket.on(LISTENING_MOD.open, () => {
            if (socket === this.selected) this.onOpen()
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
