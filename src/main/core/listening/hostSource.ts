import { randomUUID } from 'node:crypto'

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
    private pending?: { connection: ListeningConnection; source: ModListeningSource }
    private pendingTimer?: NodeJS.Timeout
    private lastActual?: { actual: ModListeningSource; itemId: string }
    appliedCommandId: string | null = null
    awaitingCommand: string | null = null
    error: string | null = null

    async report(connection: ListeningConnection, source: ModListeningSource): Promise<void> {
        this.pending = { connection, source }
        if (this.busy) return
        if (performance.now() - this.attemptedAt < 500) {
            if (!this.pendingTimer) {
                this.pendingTimer = setTimeout(
                    () => {
                        this.pendingTimer = undefined
                        const pending = this.pending
                        if (pending) void this.report(pending.connection, pending.source)
                    },
                    Math.max(50, 500 - (performance.now() - this.attemptedAt)),
                )
                this.pendingTimer.unref()
            }
            return
        }
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
        this.busy = true
        try {
            if (this.awaitingCommand && !this.appliedCommandId) return
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
            if (!this.appliedCommandId && queueChanged) {
                this.attemptedAt = performance.now()
                await connection.request(
                    'room:queue:replace',
                    {
                        roomId: room.roomId,
                        commandId: randomUUID(),
                        controllerId: room.controller.controllerId,
                        epoch: room.epoch,
                        expectedQueueRevision: room.queueRevision,
                        queue,
                    },
                    true,
                )
                if (generation !== this.generation) return
                if (connection.room?.queueRevision === room.queueRevision) {
                    const fresh = await connection.request('room:get', { roomId: room.roomId })
                    connection.accept(fresh)
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
            const last = this.lastActual
            const ordinaryProgress =
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
                    250 + clock.uncertaintyMs
            if (!this.appliedCommandId && !queueChanged && current.playback && ordinaryProgress && performance.now() - this.lastAt < 5100) return
            const itemId = this.appliedCommandId ? this.targetItemId : currentItemId
            if (!itemId) return
            const currentClock = connection.clock
            if (!currentClock) return
            const capturedAtServerMs = Math.round(currentClock.nowMs - (performance.now() - source.capturedAtMs))
            this.attemptedAt = performance.now()
            await connection.request(
                'room:playback:report',
                {
                    roomId: room.roomId,
                    controllerId: current.controller.controllerId,
                    epoch: current.epoch,
                    queueRevision: current.queueRevision,
                    sourceSeq: ++this.sequence,
                    actual: {
                        itemId,
                        status: source.status,
                        positionMs: source.positionMs,
                        durationMs: source.durationMs,
                        playbackRate: source.playbackRate,
                    },
                    capturedAtServerMs,
                    clockUncertaintyMs: clock.uncertaintyMs,
                    appliedCommandId: this.appliedCommandId,
                },
                true,
            )
            if (generation !== this.generation) return
            this.appliedCommandId = null
            this.awaitingCommand = null
            this.targetItemId = null
            this.lastAt = performance.now()
            this.lastActual = { actual: source, itemId }
            this.error = null
        } catch (error) {
            if (generation !== this.generation) return
            this.error = error instanceof Error ? error.message : 'PLAYBACK_FAILED'
            if (error instanceof Error && ['REVISION_CONFLICT', 'STALE_SOURCE', 'STALE_CONTROLLER'].includes(error.message)) connection.refresh()
        } finally {
            this.busy = false
            this.flushPending()
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
        this.targetItemId = null
        this.epoch = 0
        this.roomId = ''
        this.error = null
        this.lastActual = undefined
        this.appliedCommandId = null
        this.awaitingCommand = null
    }
}
