import { randomUUID } from 'node:crypto'

import { io } from 'socket.io-client'

import { listeningParticipant, listeningRoom, record } from '@common/listening/validation'

import { getPulseSyncUserAgent } from '../mod/network/userAgent'

import type { ListeningRoom } from '@common/listening/types'
import type { Socket } from 'socket.io-client'

export interface ListeningTicket {
    ticket: string
    expiresAt: number
}
export class ListeningConnection {
    private cancelConnect?: () => void
    private socket?: Socket
    private timer?: NodeJS.Timeout
    private clockTimer?: NodeJS.Timeout
    private generation = 0
    private refreshing = false
    private clockWork = false
    private uncertaintyMs = 2000
    private offsetMs = 0
    private clockValidUntil = 0
    room: ListeningRoom | null = null
    userId: string | null = null
    get connected(): boolean {
        return this.socket?.connected === true
    }
    get clock(): { nowMs: number; uncertaintyMs: number } | null {
        return this.clockValidUntil > Date.now() ? { nowMs: Date.now() + this.offsetMs, uncertaintyMs: this.uncertaintyMs } : null
    }
    constructor(
        private readonly ticket: () => Promise<ListeningTicket>,
        private readonly changed: () => void,
        private readonly lost: (reason: string) => void,
        private readonly command: (value: unknown) => void,
    ) {}

    async connect(serverUrl: string, socketPath = '/ws'): Promise<void> {
        this.close()
        const generation = this.generation
        const ticket = await this.ticket()
        if (generation !== this.generation) throw new Error('CANCELLED')
        const socket = io(serverUrl, {
            path: socketPath,
            transports: ['websocket'],
            reconnection: false,
            autoConnect: false,
            timeout: 5000,
            auth: { protocolVersion: 1, ticket: ticket.ticket },
            extraHeaders: { 'User-Agent': getPulseSyncUserAgent() },
            transportOptions: { websocket: { maxPayload: 65536 } },
        })
        this.socket = socket
        socket.on('room:state', value => this.accept(value))
        socket.on('room:playback', value => {
            const delta = record(value),
                room = this.room
            if (
                !room ||
                delta.roomId !== room.roomId ||
                delta.epoch !== room.epoch ||
                delta.queueRevision !== room.queueRevision ||
                delta.revision !== room.revision + 1
            )
                return this.refresh()
            this.accept({ ...room, playback: delta.playback, revision: delta.revision, serverNowMs: delta.serverNowMs })
        })
        socket.on('room:participant', value => {
            const delta = record(value),
                room = this.room
            if (!room || delta.roomId !== room.roomId || delta.revision !== room.revision + 1 || !listeningParticipant(delta.participant))
                return this.refresh()
            const participant = delta.participant
            this.accept({
                ...room,
                revision: delta.revision,
                participants: room.participants.map(entry => (entry.userId === participant.userId ? participant : entry)),
            })
        })
        socket.on('room:command', value => this.command(value))
        socket.on('room:closed', value => {
            if (record(value).roomId !== this.room?.roomId) return
            this.room = null
            this.changed()
        })
        socket.on('session:expired', value => {
            if (record(value).code === 'AUTH_INVALID') {
                this.close()
                this.room = null
                this.userId = null
                this.lost('ACCESS_REVOKED')
            } else socket.disconnect()
        })
        socket.on('disconnect', () => {
            clearTimeout(this.timer)
            clearInterval(this.clockTimer)
            if (this.socket === socket) this.lost('CONNECTION_LOST')
        })
        try {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('CONNECTION_FAILED')), 6000)
                this.cancelConnect = () => {
                    clearTimeout(timer)
                    reject(new Error('CANCELLED'))
                }
                const ready = (value: unknown) => {
                    const session = record(value)
                    clearTimeout(timer)
                    this.cancelConnect = undefined
                    if (
                        generation !== this.generation ||
                        session.protocolVersion !== 1 ||
                        typeof session.userId !== 'string' ||
                        session.userId.length > 128 ||
                        !Array.isArray(session.capabilities) ||
                        !session.capabilities.includes('session:renew') ||
                        !session.capabilities.includes('rooms:membership')
                    )
                        return reject(new Error('PROTOCOL_INVALID'))
                    if (this.userId && this.userId !== session.userId) return reject(new Error('AUTH_CHANGED'))
                    this.userId = session.userId
                    this.scheduleRenew(ticket.expiresAt, generation)
                    resolve()
                }
                socket.once('session:ready', ready)
                socket.once('connect_error', () => {
                    clearTimeout(timer)
                    reject(new Error('CONNECTION_FAILED'))
                })
                socket.connect()
            })
            if (generation !== this.generation) throw new Error('CANCELLED')
            await this.calibrate()
            this.clockTimer = setInterval(() => void this.calibrate(), 10000)
            this.clockTimer.unref()
        } catch (error) {
            if (generation === this.generation) this.close()
            throw error
        }
    }

    async request(event: string, payload: unknown, retry = false): Promise<unknown> {
        const socket = this.socket
        if (!socket?.connected) throw new Error('NOT_CONNECTED')
        let ack: unknown
        for (let attempt = 0; ; attempt++) {
            try {
                ack = await socket.timeout(4000).emitWithAck(event, payload)
                break
            } catch {
                if (!retry || attempt >= 1 || socket !== this.socket || !socket.connected) throw new Error('ACK_TIMEOUT')
            }
        }
        if (socket !== this.socket) throw new Error('CANCELLED')
        const result = record(ack)
        if (result.ok !== true) {
            const code = record(result.error).code
            throw new Error(typeof code === 'string' && /^[A-Z_]{1,40}$/u.test(code) ? code : 'PROTOCOL_INVALID')
        }
        return result.data
    }

    accept(value: unknown, replace = false): void {
        try {
            const room = listeningRoom(value)
            if (!replace && this.room && (room.roomId !== this.room.roomId || room.revision < this.room.revision)) return
            this.room = room
            this.changed()
        } catch {
            this.close()
            this.lost('PROTOCOL_INVALID')
        }
    }
    refresh(): void {
        const roomId = this.room?.roomId
        if (!roomId || this.refreshing || !this.connected) return
        this.refreshing = true
        void this.request('room:get', { roomId })
            .then(value => this.accept(value))
            .catch(() => {})
            .finally(() => {
                this.refreshing = false
            })
    }
    private async calibrate(): Promise<void> {
        if (this.clockWork || !this.connected) return
        this.clockWork = true
        const sent = Date.now(),
            generation = this.generation,
            requestId = randomUUID()
        try {
            const sample = record(await this.request('clock:ping', { requestId }))
            const received = Date.now()
            if (
                generation !== this.generation ||
                sample.requestId !== requestId ||
                !Number.isSafeInteger(sample.serverReceiveMs) ||
                !Number.isSafeInteger(sample.serverSendMs)
            )
                return
            const serverReceive = Number(sample.serverReceiveMs),
                serverSend = Number(sample.serverSendMs)
            const uncertainty = Math.ceil((received - sent - (serverSend - serverReceive)) / 2)
            if (uncertainty < 0 || uncertainty > 2000 || serverSend < serverReceive) return
            this.offsetMs = (serverReceive - sent + serverSend - received) / 2
            this.uncertaintyMs = uncertainty
            this.clockValidUntil = received + 30000
        } catch {
            /* Expired calibration suspends following until the next successful sample. */
        } finally {
            this.clockWork = false
        }
    }
    private scheduleRenew(expiresAt: number, generation: number): void {
        clearTimeout(this.timer)
        this.timer = setTimeout(
            () => {
                void this.ticket()
                    .then(async ticket => {
                        if (generation !== this.generation || !this.connected) return
                        await this.request('session:renew', { ticket: ticket.ticket })
                        if (generation === this.generation) this.scheduleRenew(ticket.expiresAt, generation)
                    })
                    .catch(() => {
                        if (generation === this.generation) {
                            this.close()
                            this.lost('ACCESS_UNAVAILABLE')
                        }
                    })
            },
            Math.max(1000, expiresAt - Date.now() - 60000),
        )
        this.timer.unref()
    }
    close(): void {
        this.generation++
        this.cancelConnect?.()
        this.cancelConnect = undefined
        clearTimeout(this.timer)
        clearInterval(this.clockTimer)
        this.clockValidUntil = 0
        const socket = this.socket
        this.socket = undefined
        if (socket) {
            socket.sendBuffer = []
            socket.removeAllListeners()
            socket.disconnect()
        }
    }
}
