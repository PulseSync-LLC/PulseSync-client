import { io } from 'socket.io-client'

import config, { branch } from '@common/appConfig'
import { desktopApi } from '@shared/desktop/desktopApi'

import type { ClientBuildIdentity } from '@common/types/clientBuildIdentity'
import type { ClientHardwareIdentity } from '@common/types/clientHardwareIdentity'
import type { Socket } from 'socket.io-client'

export type GatewayFrame<T = any> = {
    e?: string
    d?: T
}

export type RealtimeSocketAuth = {
    page: string
    version: string
    buildIdentity?: ClientBuildIdentity
    hardwareIdentity?: ClientHardwareIdentity | null
    compression: 'zstd-stream'
    inboundCompression: 'zstd-stream'
}

export function createRealtimeSocket(auth: RealtimeSocketAuth): Socket {
    return io(config.SOCKET_URL, {
        path: '/ws',
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        auth: realtimeAuth(auth),
        transports: ['websocket'],
    })
}

export function updateRealtimeSocketAuth(socket: Socket, auth: RealtimeSocketAuth) {
    socket.auth = realtimeAuth(auth)
}

function realtimeAuth(auth: RealtimeSocketAuth): Socket['auth'] {
    return (send: (data: object) => void) => {
        void desktopApi.auth
            .getToken()
            .catch(() => '')
            .then(token => {
                send({ ...auth, token, renewAccess: true, addonReleaseChannels: true, clientChannel: branch === 'dev' ? 'dev' : 'beta' })
            })
    }
}

export function reconnectOnAuthExpiry(socket: Socket, onExpired: () => void): () => void {
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const reconnect = async () => {
        try {
            const token = await desktopApi.auth.getToken()
            if (!stopped && token) socket.connect()
        } catch {
            if (!stopped) retryTimer = setTimeout(() => void reconnect(), 15_000)
        }
    }

    const handleExpiry = () => {
        onExpired()
        socket.once('disconnect', reconnect)
    }
    const handleRenewal = async (ack: unknown) => {
        if (typeof ack !== 'function') return
        const token = await desktopApi.auth.getToken().catch(() => '')
        if (!stopped && socket.connected) ack(token)
    }
    socket.on('auth_renew', handleRenewal)
    socket.on('auth_expired', handleExpiry)

    return () => {
        stopped = true
        clearTimeout(retryTimer)
        socket.off('auth_renew', handleRenewal)
        socket.off('auth_expired', handleExpiry)
        socket.off('disconnect', reconnect)
    }
}

export function parseGatewayFrame(buf: ArrayBuffer | Uint8Array, zstd: any): GatewayFrame | null {
    if (!zstd) return null
    try {
        const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf as any)
        const out: Uint8Array = zstd.decompress(u8)
        return JSON.parse(new TextDecoder().decode(out)) as GatewayFrame
    } catch {
        return null
    }
}
