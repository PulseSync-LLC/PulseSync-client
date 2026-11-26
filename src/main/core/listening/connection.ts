import { randomUUID } from 'node:crypto'

import { io } from 'socket.io-client'

import { listeningParticipant, listeningRoom, listeningUuid, record } from '@common/listening/validation'

import { getPulseSyncUserAgent } from '../mod/network/userAgent'

import type { ListeningRoom } from '@common/listening/types'
import type { Socket } from 'socket.io-client'

export interface ListeningTicket {
    ticket: string
    expiresAt: number
    renewAtMonotonicMs: number
}
export class ListeningConnection {
    private cancelConnect?: () => void
    private socket?: Socket
    private timer?: NodeJS.Timeout
    private clockTimer?: NodeJS.Timeout
    private generation = 0
    private clockWork: number | null = null
    private uncertaintyMs = 2000
    private offsetMs = 0
    private clockValidUntil = 0
    private snapshotAt = 0
    private rttMs: number | null = null
    private refreshGeneration: number | null = null
    room: ListeningRoom | null = null
    resumableRoomId: string | null = null
    userId: string | null = null
    queueModes = false
    get diagnostics() {
        return {
            rttMs: this.rttMs,
            clockUncertaintyMs: this.clock?.uncertaintyMs ?? null,
            snapshotAgeMs: this.room && this.snapshotAt ? Math.round(performance.now() - this.snapshotAt) : null,
        }
    }
    get connected(): boolean {
        return this.socket?.connected === true
    }
    get clock(): { nowMs: number; uncertaintyMs: number } | null {
        const now = performance.now()
        return this.clockValidUntil > now ? { nowMs: now + this.offsetMs, uncertaintyMs: this.uncertaintyMs } : null
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
            if (room && delta.roomId === room.roomId && typeof delta.revision === 'number' && delta.revision <= room.revision) return
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
            if (room && delta.roomId === room.roomId && typeof delta.revision === 'number' && delta.revision <= room.revision) return
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
            this.resumableRoomId = null
            this.lost('ROOM_ENDED')
        })
        socket.on('session:expired', value => {
            if (record(value).code === 'AUTH_INVALID') {
                this.close()
                this.room = null
                this.userId = null
                this.lost('ACCESS_REVOKED')
            } else socket.disconnect()
        })
        socket.on('disconnect', reason => {
            clearTimeout(this.timer)
            clearInterval(this.clockTimer)
            this.clockValidUntil = 0
            socket.sendBuffer = []
            if (this.socket === socket) this.lost(reason === 'ping timeout' ? 'HEARTBEAT_TIMEOUT' : 'CONNECTION_LOST')
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
                        (session.roomId !== undefined && session.roomId !== null && !listeningUuid(session.roomId)) ||
                        !session.capabilities.includes('rooms:membership')
                    )
                        return reject(new Error('PROTOCOL_INVALID'))
                    if (this.userId && this.userId !== session.userId) return reject(new Error('AUTH_CHANGED'))
                    this.userId = session.userId
                    this.resumableRoomId = typeof session.roomId === 'string' ? session.roomId : null
                    this.queueModes = session.queueModes === true
                    this.scheduleRenew(ticket.renewAtMonotonicMs, generation)
                    resolve()
                }
                socket.once('session:ready', ready)
                socket.once('connect_error', (error: Error & { data?: { code?: string } }) => {
                    clearTimeout(timer)
                    reject(new Error(error.data?.code && /^[A-Z_]{1,40}$/u.test(error.data.code) ? error.data.code : 'CONNECTION_FAILED'))
                })
                socket.once('disconnect', () => {
                    clearTimeout(timer)
                    reject(new Error('CONNECTION_LOST'))
                })
                socket.connect()
            })
            if (generation !== this.generation) throw new Error('CANCELLED')
            await this.calibrate()
            if (generation !== this.generation || !socket.connected) throw new Error('CANCELLED')
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
                ack = await socket.volatile.timeout(4000).emitWithAck(event, payload)
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
        if (!replace && !this.room) return
        try {
            const room = listeningRoom(value)
            if (!replace && this.room && (room.roomId !== this.room.roomId || room.revision < this.room.revision)) return
            this.room = room
            this.snapshotAt = performance.now()
            this.changed()
        } catch {
            this.close()
            this.lost('PROTOCOL_INVALID')
        }
    }
    refresh(): void {
        const roomId = this.room?.roomId
        if (!roomId || this.refreshGeneration === this.generation || !this.connected) return
        const generation = this.generation
        this.refreshGeneration = generation
        void this.request('room:get', { roomId })
            .then(value => {
                if (generation === this.generation && this.room?.roomId === roomId) this.accept(value)
            })
            .catch(error => {
                if (generation !== this.generation) return
                if (error instanceof Error && ['FORBIDDEN', 'ROOM_NOT_FOUND', 'ROOM_CLOSED'].includes(error.message)) this.lost('ROOM_ENDED')
            })
            .finally(() => {
                if (this.refreshGeneration === generation) {
                    this.refreshGeneration = null
                }
            })
    }
    private async calibrate(): Promise<void> {
        if (this.clockWork === this.generation || !this.connected) return
        this.clockWork = this.generation
        const sent = performance.now(),
            generation = this.generation,
            requestId = randomUUID()
        try {
            const sample = record(await this.request('clock:ping', { requestId }))
            const received = performance.now()
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
            if (this.clockValidUntil > received && uncertainty > this.uncertaintyMs + 10) return
            this.offsetMs = (serverReceive - sent + serverSend - received) / 2
            this.rttMs = Math.round(received - sent)
            this.uncertaintyMs = uncertainty
            this.clockValidUntil = received + 30000
        } catch {
            /* Expired calibration suspends following until the next successful sample. */
        } finally {
            if (this.clockWork === generation) this.clockWork = null
        }
    }
    private scheduleRenew(renewAtMonotonicMs: number, generation: number): void {
        clearTimeout(this.timer)
        this.timer = setTimeout(
            () => {
                void this.ticket()
                    .then(async ticket => {
                        if (generation !== this.generation || !this.connected) return
                        await this.request('session:renew', { ticket: ticket.ticket })
                        if (generation === this.generation) this.scheduleRenew(ticket.renewAtMonotonicMs, generation)
                    })
                    .catch(() => {
                        if (generation === this.generation) {
                            this.close()
                            this.lost('ACCESS_UNAVAILABLE')
                        }
                    })
            },
            Math.max(1000, renewAtMonotonicMs - performance.now()),
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
        this.rttMs = null
        this.queueModes = false
        this.resumableRoomId = null
        const socket = this.socket
        this.socket = undefined
        if (socket) {
            socket.sendBuffer = []
            socket.removeAllListeners()
            socket.disconnect()
        }
    }
}
