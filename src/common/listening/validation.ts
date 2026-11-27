import type { ListeningAction, ListeningOperation, ListeningParticipant, ListeningRoom, ModListeningSource } from './types'

export const listeningUuid = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
const catalog = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/u.test(value)
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const rate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 2
export const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const oneOf = (value: unknown, values: readonly unknown[]) => values.includes(value)
const connection = (value: unknown) => oneOf(value, ['online', 'reconnecting'])
const status = (value: unknown) => oneOf(value, ['playing', 'paused', 'buffering'])
const reason = (value: unknown) => oneOf(value, [null, 'track_unavailable', 'playback_failed', 'device_taken_over', 'client_unavailable'])
export function listeningParticipant(value: unknown): value is ListeningParticipant {
    const entry = record(value)
    return (
        id(entry.userId) &&
        oneOf(entry.role, ['host', 'listener']) &&
        connection(entry.connection) &&
        oneOf(entry.following, ['following', 'buffering', 'unavailable', 'suspended']) &&
        reason(entry.reason)
    )
}

// Validate remote state before it can cross the preload or player boundary. The server
// remains authoritative; this decoder is the protocol-v1 consumer, not a source of permissions.
export function listeningRoom(value: unknown): ListeningRoom {
    const room = record(value),
        queue = record(room.queue),
        controller = record(room.controller),
        offer = record(room.hostOffer),
        playback = record(room.playback),
        actual = record(playback.actual)
    const valid =
        new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength <= 32768 &&
        listeningUuid(room.roomId) &&
        id(room.ownerUserId) &&
        (room.hostUserId === null || id(room.hostUserId)) &&
        oneOf(room.status, ['open', 'suspended', 'closed']) &&
        integer(room.epoch, 1) &&
        integer(room.revision, 1) &&
        integer(room.queueRevision) &&
        integer(room.serverNowMs, 1) &&
        Array.isArray(room.participants) &&
        room.participants.length <= 10 &&
        (room.participantLimit === undefined || oneOf(room.participantLimit, [3, 10])) &&
        room.participants.every(listeningParticipant) &&
        new Set(room.participants.map(entry => record(entry).userId)).size === room.participants.length &&
        (queue.repeatMode === undefined || oneOf(queue.repeatMode, ['none', 'context', 'one'])) &&
        (queue.shuffle === undefined || typeof queue.shuffle === 'boolean') &&
        Array.isArray(queue.items) &&
        queue.items.length <= 32 &&
        queue.items.every(
            item =>
                listeningUuid(record(item).itemId) &&
                catalog(record(item).trackId) &&
                (record(item).albumId === null || catalog(record(item).albumId)),
        ) &&
        new Set(queue.items.map(item => record(item).itemId)).size === queue.items.length &&
        (queue.currentItemId === null || queue.items.some(item => record(item).itemId === queue.currentItemId)) &&
        (room.controller === null ||
            (listeningUuid(controller.controllerId) &&
                id(controller.userId) &&
                connection(controller.connection) &&
                controller.userId === room.hostUserId)) &&
        (room.hostOffer === null ||
            (listeningUuid(offer.offerId) &&
                id(offer.fromUserId) &&
                id(offer.targetUserId) &&
                integer(offer.epoch, 1) &&
                integer(offer.expiresAt, 1))) &&
        (room.playback === null ||
            (listeningUuid(actual.itemId) &&
                actual.itemId === queue.currentItemId &&
                status(actual.status) &&
                integer(actual.positionMs, 0, 86400000) &&
                (actual.durationMs === null || integer(actual.durationMs, 1, 86400000)) &&
                rate(actual.playbackRate) &&
                integer(playback.anchorServerMs, 1) &&
                integer(playback.sourceSeq, 1) &&
                (playback.appliedCommandId === null || listeningUuid(playback.appliedCommandId)) &&
                (playback.clockUncertaintyMs === null || integer(playback.clockUncertaintyMs, 0, 2000))))
    if (!valid) throw new Error('PROTOCOL_INVALID')
    return value as ListeningRoom
}

export function listeningSource(value: unknown): ModListeningSource | null {
    const source = record(value)
    if (
        (source.synchronization !== undefined && !oneOf(source.synchronization, [null, 'preparing', 'timeout'])) ||
        (source.repeatMode !== undefined && !oneOf(source.repeatMode, ['none', 'context', 'one'])) ||
        (source.shuffle !== undefined && typeof source.shuffle !== 'boolean') ||
        !integer(source.capturedAtMs, 1) ||
        !Array.isArray(source.items) ||
        source.items.length > 32 ||
        (!source.items.length && source.reason !== 'track_unavailable') ||
        !source.items.every(item => catalog(record(item).trackId) && (record(item).albumId === null || catalog(record(item).albumId))) ||
        !integer(source.currentIndex, 0, Math.max(0, source.items.length - 1)) ||
        !status(source.status) ||
        !integer(source.positionMs, 0, 86400000) ||
        !(source.durationMs === null || integer(source.durationMs, 1, 86400000)) ||
        !rate(source.playbackRate) ||
        !reason(source.reason)
    )
        return null
    return value as ModListeningSource
}
export function listeningAction(value: unknown): value is ListeningAction {
    const action = record(value)
    return (
        (action.type === 'setPaused' && typeof action.paused === 'boolean') ||
        (action.type === 'seek' && integer(action.positionMs, 0, 86400000)) ||
        (action.type === 'selectItem' && listeningUuid(action.itemId)) ||
        oneOf(action.type, ['next', 'previous']) ||
        (action.type === 'setRate' && rate(action.playbackRate))
    )
}
export function listeningOperation(value: unknown): ListeningOperation {
    const operation = record(value)
    if (
        oneOf(operation.type, ['create', 'leave', 'close', 'invite', 'accept', 'decline']) ||
        (operation.type === 'join' && typeof operation.invitation === 'string' && operation.invitation.length < 512) ||
        (oneOf(operation.type, ['offer', 'transfer', 'kick']) && id(operation.userId)) ||
        (operation.type === 'control' && listeningAction(operation.action))
    )
        return value as ListeningOperation
    throw new Error('INVALID_PAYLOAD')
}
