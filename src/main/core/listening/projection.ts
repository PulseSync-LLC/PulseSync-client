import type { ListeningConnection } from './connection'
import type { ModListeningFrame } from '@common/listening/types'

export function projectListeningFrame(
    connection: Pick<ListeningConnection, 'room' | 'clock' | 'userId' | 'connected'>,
    available: boolean,
    disconnectedAt: number,
    command: ModListeningFrame['command'],
): ModListeningFrame {
    const room = connection.room,
        clock = connection.clock
    const role = room ? (room.hostUserId === connection.userId ? 'host' : 'listener') : null
    const active = available && (!disconnectedAt || performance.now() - disconnectedAt < 20000)
    const hostUnavailable = room?.participants.some(participant => participant.userId === room.hostUserId && participant.following === 'unavailable')
    const playback = room?.playback,
        item = room?.queue.items.find(entry => entry.itemId === playback?.actual.itemId)
    const age = playback && clock ? clock.nowMs - playback.anchorServerMs : Infinity
    const target =
        connection.connected &&
        room?.status === 'open' &&
        room.controller?.connection === 'online' &&
        playback &&
        playback.clockUncertaintyMs !== null &&
        item &&
        clock &&
        age >= -2000 &&
        age <= 10000
            ? {
                  item,
                  durationMs: playback.actual.durationMs,
                  status: hostUnavailable ? 'buffering' : playback.actual.status,
                  playbackRate: playback.actual.playbackRate,
                  positionMs: Math.round(
                      Math.min(
                          playback.actual.durationMs ?? 86400000,
                          playback.actual.positionMs + (playback.actual.status === 'playing' ? Math.max(0, age) * playback.actual.playbackRate : 0),
                      ),
                  ),
              }
            : null
    return {
        protocolVersion: 1,
        enabled: active,
        role: active ? role : null,
        roomId: room?.roomId ?? null,
        epoch: room?.epoch ?? 0,
        revision: room?.revision ?? 0,
        validForMs: 3000,
        target: role === 'listener' ? target : null,
        command: role === 'host' ? command : null,
        queue: room?.queue.items ?? [],
        repeatMode: room?.queue.repeatMode ?? 'none',
        shuffle: room?.queue.shuffle ?? false,
    }
}
