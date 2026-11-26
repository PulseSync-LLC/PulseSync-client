import { randomUUID } from 'node:crypto'

import { record } from '@common/listening/validation'

import type { ListeningConnection } from './connection'
import type { ListeningItem, ListeningRoom, ModListeningSource } from '@common/listening/types'

function sameQueue(left: ListeningRoom['queue'], right: ListeningRoom['queue']): boolean {
    return (
        left.currentItemId === right.currentItemId &&
        (left.repeatMode ?? 'none') === (right.repeatMode ?? 'none') &&
        (left.shuffle ?? false) === (right.shuffle ?? false) &&
        left.items.length === right.items.length &&
        left.items.every((item, index) => {
            const other = right.items[index]!
            return item.itemId === other.itemId && item.trackId === other.trackId && item.albumId === other.albumId
        })
    )
}

export class HostSource {
    private generation = 0
    private targetItemId: string | null = null
    private epoch = 0
    private roomId = ''
    private sequence = 0
    private busy = false
    private lastAt = 0
    private attemptedAt = -Infinity
    private retryAt = 0
    private pending?: { connection: ListeningConnection; source: ModListeningSource }
    private pendingTimer?: NodeJS.Timeout
    private lastActual?: { actual: ModListeningSource; itemId: string }
    appliedCommandId: string | null = null
    awaitingCommand: string | null = null
    error: string | null = null

    async report(connection: ListeningConnection, source: ModListeningSource): Promise<void> {
        this.pending = { connection, source }
        if (this.busy) return
        clearTimeout(this.pendingTimer)
        this.pendingTimer = undefined
        this.pending = undefined
        const room = connection.room,
            clock = connection.clock
        if (
            !connection.connected ||
            !clock ||
            !room ||
            room.hostUserId !== connection.userId ||
            !room.controller ||
            room.status !== 'open' ||
            source.reason ||
            performance.now() - source.capturedAtMs > 3000
        )
            return
        this.prepare(room)
        const generation = this.generation
        if (this.awaitingCommand && !this.appliedCommandId) return
        this.busy = true
        try {
            const available = new Map<string, string[]>()
            for (const item of room.queue.items) {
                const key = JSON.stringify([item.trackId, item.albumId])
                const ids = available.get(key) ?? []
                ids.push(item.itemId)
                available.set(key, ids)
            }
            const items: ListeningItem[] = source.items.map(item => {
                const key = JSON.stringify([item.trackId, item.albumId])
                return { ...item, itemId: available.get(key)?.shift() ?? randomUUID() }
            })
            const currentItemId = items[source.currentIndex]!.itemId
            const queue = {
                items,
                currentItemId,
                ...(connection.queueModes ? { repeatMode: source.repeatMode ?? 'none', shuffle: source.shuffle ?? false } : {}),
            }
            const queueChanged = !sameQueue(room.queue, queue)
            const last = this.lastActual
            const ordinaryProgress = Boolean(
                last &&
                last.itemId === currentItemId &&
                last.actual.status === source.status &&
                last.actual.durationMs === source.durationMs &&
                last.actual.playbackRate === source.playbackRate &&
                Math.abs(
                    source.positionMs -
                        (last.actual.positionMs +
                            (source.status === 'playing' ? (source.capturedAtMs - last.actual.capturedAtMs) * source.playbackRate : 0)),
                ) <=
                    250 + clock.uncertaintyMs + (room.playback?.clockUncertaintyMs ?? 0),
            )
            if (!this.appliedCommandId && !queueChanged && room.playback && ordinaryProgress && performance.now() - this.lastAt < 5100) return
            const now = performance.now()
            const urgent = this.appliedCommandId !== null || queueChanged || !ordinaryProgress
            const delay = Math.max(this.retryAt - now, urgent ? 0 : 500 - (now - this.attemptedAt))
            if (delay > 0) {
                this.pending = { connection, source }
                this.pendingTimer = setTimeout(
                    () => {
                        this.pendingTimer = undefined
                        this.flushPending()
                    },
                    Math.max(25, delay),
                )
                this.pendingTimer.unref()
                return
            }
            let atomic = false
            if (!this.appliedCommandId && queueChanged) {
                this.attemptedAt = performance.now()
                const result = record(
                    await connection.request(
                        'room:queue:replace',
                        {
                            roomId: room.roomId,
                            commandId: randomUUID(),
                            controllerId: room.controller.controllerId,
                            epoch: room.epoch,
                            expectedQueueRevision: room.queueRevision,
                            queue,
                            ...(connection.queuePlayback
                                ? { playback: playbackSample(source, currentItemId, ++this.sequence, connection.clock ?? clock) }
                                : {}),
                        },
                        true,
                    ),
                )
                if (generation !== this.generation) return
                if (connection.queuePlayback) {
                    if (!result.snapshot) throw new Error('PROTOCOL_INVALID')
                    connection.accept(result.snapshot)
                    atomic = true
                } else if (connection.room?.queueRevision === room.queueRevision) {
                    connection.accept(await connection.request('room:get', { roomId: room.roomId }))
                }
            }
            if (generation !== this.generation) return
            const current = connection.room
            if (
                !current ||
                current.roomId !== room.roomId ||
                current.epoch !== room.epoch ||
                current.hostUserId !== connection.userId ||
                !current.controller
            )
                return
            const itemId = this.appliedCommandId ? this.targetItemId : currentItemId
            if (!itemId) return
            if (!atomic) {
                const currentClock = connection.clock
                if (!currentClock) return
                this.attemptedAt = performance.now()
                await connection.request(
                    'room:playback:report',
                    {
                        roomId: current.roomId,
                        controllerId: current.controller.controllerId,
                        epoch: current.epoch,
                        queueRevision: current.queueRevision,
                        ...playbackSample(source, itemId, ++this.sequence, currentClock),
                        appliedCommandId: this.appliedCommandId,
                    },
                    true,
                )
            }
            if (generation !== this.generation) return
            this.appliedCommandId = null
            this.awaitingCommand = null
            this.targetItemId = null
            this.lastAt = performance.now()
            this.lastActual = { actual: source, itemId }
            this.error = null
            this.retryAt = 0
        } catch (error) {
            if (generation !== this.generation) return
            this.error = error instanceof Error ? error.message : 'PLAYBACK_FAILED'
            this.retryAt = performance.now() + Math.max(500, Number(record(error).retryAfterMs) || 0)
            this.pending ??= { connection, source }
            if (error instanceof Error && ['REVISION_CONFLICT', 'STALE_SOURCE', 'STALE_CONTROLLER'].includes(error.message)) connection.refresh()
        } finally {
            this.busy = false
            if (!this.pendingTimer) this.flushPending()
        }
    }

    private flushPending(): void {
        const pending = this.pending
        if (pending) void this.report(pending.connection, pending.source)
    }
    private prepare(room: ListeningRoom): void {
        if (this.roomId === room.roomId && this.epoch === room.epoch) return
        this.reset()
        this.roomId = room.roomId
        this.epoch = room.epoch
        this.sequence = 0
        this.lastAt = 0
    }
    expectCommand(room: ListeningRoom, commandId: string, itemId: string | null): void {
        this.prepare(room)
        this.awaitingCommand = commandId
        this.targetItemId = itemId
    }
    commandApplied(commandId: string, ok: boolean): void {
        if (commandId !== this.awaitingCommand) return
        if (ok) this.appliedCommandId = commandId
        else this.awaitingCommand = null
    }
    reset(): void {
        this.generation++
        clearTimeout(this.pendingTimer)
        this.pendingTimer = undefined
        this.pending = undefined
        this.attemptedAt = -Infinity
        this.retryAt = 0
        this.targetItemId = null
        this.epoch = 0
        this.roomId = ''
        this.error = null
        this.lastActual = undefined
        this.appliedCommandId = null
        this.awaitingCommand = null
    }
}

function playbackSample(source: ModListeningSource, itemId: string, sourceSeq: number, clock: { nowMs: number; uncertaintyMs: number }) {
    return {
        sourceSeq,
        actual: {
            itemId,
            status: source.status,
            positionMs: source.positionMs,
            durationMs: source.durationMs,
            playbackRate: source.playbackRate,
        },
        capturedAtServerMs: Math.round(clock.nowMs - (performance.now() - source.capturedAtMs)),
        clockUncertaintyMs: clock.uncertaintyMs,
    }
}
