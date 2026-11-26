export interface ListeningItem {
    itemId: string
    trackId: string
    albumId: string | null
}
export interface ListeningActual {
    itemId: string
    status: 'playing' | 'paused' | 'buffering'
    positionMs: number
    durationMs: number | null
    playbackRate: number
}
export interface ListeningParticipant {
    userId: string
    role: 'host' | 'listener'
    connection: 'online' | 'reconnecting'
    following: 'following' | 'buffering' | 'unavailable' | 'suspended'
    reason: 'track_unavailable' | 'playback_failed' | 'device_taken_over' | 'client_unavailable' | null
}
export interface ListeningRoom {
    roomId: string
    ownerUserId: string
    hostUserId: string | null
    status: 'open' | 'suspended' | 'closed'
    epoch: number
    revision: number
    queueRevision: number
    participants: ListeningParticipant[]
    controller: { controllerId: string; userId: string; connection: 'online' | 'reconnecting' } | null
    queue: { items: ListeningItem[]; currentItemId: string | null; repeatMode?: 'none' | 'context' | 'one'; shuffle?: boolean }
    playback: {
        actual: ListeningActual
        anchorServerMs: number
        sourceSeq: number
        appliedCommandId: string | null
        clockUncertaintyMs: number | null
    } | null
    hostOffer: { offerId: string; fromUserId: string; targetUserId: string; epoch: number; expiresAt: number } | null
    serverNowMs: number
}
export type ListeningAction =
    | { type: 'setPaused'; paused: boolean }
    | { type: 'seek'; positionMs: number }
    | { type: 'selectItem'; itemId: string }
    | { type: 'next' | 'previous' }
    | { type: 'setRate'; playbackRate: number }
export type ListeningOperation =
    | { type: 'create' | 'leave' | 'close' | 'invite' | 'accept' | 'decline' }
    | { type: 'join'; invitation: string }
    | { type: 'offer'; userId: string }
    | { type: 'control'; action: ListeningAction }
export interface ListeningView {
    available: boolean
    connection: 'idle' | 'connecting' | 'connected' | 'reconnecting'
    userId: string | null
    room: ListeningRoom | null
    modReady: boolean
    error: string | null
    diagnostics?: {
        rttMs: number | null
        clockUncertaintyMs: number | null
        snapshotAgeMs: number | null
        sourceAgeMs: number | null
        reconnectAttempt: number
        retryInMs: number | null
        lastDisconnectReason: string | null
        sourceError: string | null
    }
}
export const LISTENING_IPC = { get: 'listening:get', run: 'listening:run', stop: 'listening:stop', changed: 'listening:changed' } as const
export const LISTENING_MOD = {
    hello: 'LISTENING_HELLO',
    source: 'LISTENING_SOURCE',
    frame: 'LISTENING_FRAME',
    applied: 'LISTENING_APPLIED',
    open: 'LISTENING_OPEN',
} as const
export interface ModListeningSource {
    repeatMode?: 'none' | 'context' | 'one'
    shuffle?: boolean
    capturedAtMs: number
    items: { trackId: string; albumId: string | null }[]
    currentIndex: number
    status: ListeningActual['status']
    positionMs: number
    durationMs: number | null
    playbackRate: number
    reason: ListeningParticipant['reason']
}
export interface ModListeningFrame {
    protocolVersion: 1
    enabled: boolean
    role: 'host' | 'listener' | null
    roomId: string | null
    epoch: number
    revision: number
    validForMs: number
    repeatMode?: 'none' | 'context' | 'one'
    shuffle?: boolean
    target: { item: ListeningItem; status: ListeningActual['status']; positionMs: number; playbackRate: number; durationMs?: number | null } | null
    queue: ListeningItem[]
    command: { commandId: string; action: ListeningAction; item?: ListeningItem } | null
}
