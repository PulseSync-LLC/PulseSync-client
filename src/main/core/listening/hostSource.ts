import { randomUUID } from 'node:crypto'

import type { ListeningConnection } from './connection'
import type { ListeningItem, ListeningRoom, ModListeningSource } from '@common/listening/types'

export class HostSource {
    private generation = 0
    private targetItemId: string | null = null
    private items = new Map<string, string>()
    private epoch = 0
    private roomId = ''
    private sequence = 0
    private busy = false
    private lastAt = 0
    private lastActual?: { actual: ModListeningSource; itemId: string }
    appliedCommandId: string | null = null
    awaitingCommand: string | null = null

    async report(connection: ListeningConnection, source: ModListeningSource): Promise<void> {
        const room = connection.room,
            clock = connection.clock
        if (
            this.busy ||
            !connection.connected ||
            !clock ||
            !room ||
            room.hostUserId !== connection.userId ||
            !room.controller ||
            room.status !== 'open' ||
            source.reason ||
            Date.now() - source.capturedAtMs > 3000
        )
            return
        this.prepare(room)
        const generation = this.generation
        this.busy = true
        try {
            if (this.awaitingCommand && !this.appliedCommandId) return
            const items: ListeningItem[] = source.items.map((item, index) => {
                const key = JSON.stringify([index, item.trackId, item.albumId])
                return { ...item, itemId: this.items.get(key) ?? randomUUID() }
            })
            this.items = new Map(items.map((item, index) => [JSON.stringify([index, item.trackId, item.albumId]), item.itemId]))
            const currentItemId = items[source.currentIndex]!.itemId
            const queue = { items, currentItemId }
            if (!this.appliedCommandId && JSON.stringify(room.queue) !== JSON.stringify(queue)) {
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
                const fresh = await connection.request('room:get', { roomId: room.roomId })
                connection.accept(fresh)
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
            if (!this.appliedCommandId && ordinaryProgress && Date.now() - this.lastAt < 5100) return
            const itemId = this.appliedCommandId ? this.targetItemId : currentItemId
            if (!itemId) return
            const capturedAtServerMs = Math.round(clock.nowMs - (Date.now() - source.capturedAtMs))
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
            this.lastAt = Date.now()
            this.lastActual = { actual: source, itemId }
        } catch (error) {
            if (error instanceof Error && ['REVISION_CONFLICT', 'STALE_SOURCE', 'STALE_CONTROLLER'].includes(error.message)) connection.refresh()
        } finally {
            this.busy = false
        }
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
        this.targetItemId = null
        this.epoch = 0
        this.roomId = ''
        this.items.clear()
        this.lastActual = undefined
        this.appliedCommandId = null
        this.awaitingCommand = null
    }
}
