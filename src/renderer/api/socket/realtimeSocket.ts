import { io, Socket } from 'socket.io-client'
import config from '@common/appConfig'

export type GatewayFrame<T = any> = {
    e?: string
    d?: T
}

export type RealtimeSocketAuth = {
    page: string
    token: string | null
    version: string
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
        auth,
        transports: ['websocket'],
    })
}

export function updateRealtimeSocketAuth(socket: Socket, auth: RealtimeSocketAuth) {
    socket.auth = auth
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
