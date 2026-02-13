import type { Socket } from 'socket.io-client'
import type { RealtimeSocketAuth } from '../../socket/realtimeSocket'
import type { OutgoingGatewayEvent } from '../../socket/enums/outgoingGatewayEvents'
import OutgoingSocketEvents from '../../socket/enums/outgoingSocketEvents'
import getUserToken from '../../getUserToken'

const SOCKET_VERSION_FALLBACK = '0.0.0'
const COMPRESSION_LEVEL = 3

export const SOCKET_OFFLINE_CLEAR_AFTER_MS = 15000
export const CONNECTION_ERROR_TOAST_THRESHOLD = 3

export function buildRealtimeSocketAuth(appVersion: string): RealtimeSocketAuth {
    const rawHash = window.location?.hash || ''
    const page = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash
    const version = (appVersion || SOCKET_VERSION_FALLBACK).split('-')[0]

    return {
        page,
        token: getUserToken(),
        version,
        compression: 'zstd-stream',
        inboundCompression: 'zstd-stream',
    }
}

export function clearDiscordRpcActivity() {
    if ((window as any)?.discordRpc?.clearActivity) {
        ;(window as any).discordRpc.clearActivity()
    }
}

export function getGatewayErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const value = (payload as { message?: unknown }).message
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

type EmitCompressedGatewayParams = {
    socket: Socket | null
    zstdReady: boolean
    zstd: any
    event: OutgoingGatewayEvent
    payload: unknown
}

export function emitCompressedGateway({ socket, zstdReady, zstd, event, payload }: EmitCompressedGatewayParams): void {
    if (!socket || !socket.connected || !zstdReady || !zstd) return

    try {
        const frame = new TextEncoder().encode(JSON.stringify({ e: event, d: payload }))
        const compressed: Uint8Array = zstd.compress(frame, COMPRESSION_LEVEL)
        socket.emit(OutgoingSocketEvents.GATEWAY, compressed)
    } catch {}
}
