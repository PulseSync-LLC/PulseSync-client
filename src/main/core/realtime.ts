import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'

import { io } from 'socket.io-client'

import config, { branch } from '@common/appConfig'
import { normalizeTrack } from '@common/player/track'
import trackInitials from '@common/player/trackInitials'

import logger from '../shared/logger'
import { currentAuthSessionId, getAuthToken } from './auth/session'
import { getState } from './state'
import { listAddonMetadata } from './utils/addonRegistry'

import type { BackgroundConfiguration, BackgroundConnection, BackgroundEvent, BackgroundPreferences, GatewayFrame } from '@common/background'
import type { Track } from '@common/player/track.types'
import type { Socket } from 'socket.io-client'

class DesktopRealtime {
    private socket: Socket | null = null
    private configuration?: BackgroundConfiguration
    private sessionId = ''
    private failures = 0
    private connectionRevision = 0
    private authRetry?: NodeJS.Timeout
    private track: Track = trackInitials
    private lastTrack = ''
    private lastTrackAt = 0
    private lastMetrics = ''
    preferences?: BackgroundPreferences
    onEvent: (event: BackgroundEvent) => void = () => {}
    onLogout: () => void = () => {}

    get userId(): string {
        return this.configuration?.userId ?? ''
    }

    setPreferences(preferences: BackgroundPreferences): void {
        this.preferences = preferences
        this.sendTrack()
        this.sendMetrics()
    }

    snapshot(): BackgroundConnection {
        return { connected: this.socket?.connected === true, revision: this.connectionRevision, failures: this.failures, userId: this.userId }
    }

    async start(configuration: BackgroundConfiguration): Promise<BackgroundConnection> {
        const sessionId = currentAuthSessionId()
        if (this.configuration?.userId === configuration.userId && this.sessionId === sessionId && this.socket) {
            this.configuration = configuration
            return this.snapshot()
        }
        const preferences = this.preferences?.userId === configuration.userId ? this.preferences : undefined
        this.stop()
        this.preferences = preferences
        this.configuration = configuration
        this.sessionId = sessionId
        const socket = io(config.SOCKET_URL, {
            path: '/ws',
            autoConnect: false,
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
            transports: ['websocket'],
            auth: send => {
                const identity = this.configuration
                void getAuthToken()
                    .catch(() => '')
                    .then(nextToken => {
                        if (this.socket !== socket || !identity) return
                        this.sessionId = currentAuthSessionId()
                        send({
                            ...identity,
                            compression: 'zstd-stream',
                            inboundCompression: 'zstd-stream',
                            token: nextToken,
                            renewAccess: true,
                            addonReleaseChannels: true,
                            clientChannel: branch === 'dev' ? 'dev' : 'beta',
                        })
                        if (!nextToken) this.scheduleAuthRetry(socket)
                    })
            },
        })
        this.socket = socket
        socket.on('connect', () => {
            this.connectionRevision++
            clearTimeout(this.authRetry)
            this.failures = 0
            this.onEvent({ type: 'connection', connection: this.snapshot() })
            this.sendTrack()
            this.sendMetrics()
        })
        const disconnected = () => {
            this.connectionRevision++
            this.failures++
            this.onEvent({ type: 'connection', connection: this.snapshot() })
        }
        socket.on('disconnect', disconnected)
        socket.on('connect_error', () => {
            disconnected()
            if (!socket.active) this.scheduleAuthRetry(socket)
        })
        socket.on('auth_renew', (ack: unknown) => {
            if (typeof ack !== 'function') return
            void getAuthToken()
                .catch(() => '')
                .then(nextToken => {
                    if (this.socket === socket && socket.connected) ack(nextToken)
                })
        })
        socket.on('auth_expired', () => {
            socket.once('disconnect', () => void this.reconnectAfterExpiry(socket))
        })
        socket.on('gw', (bytes: ArrayBuffer | Uint8Array) => {
            try {
                const input = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
                const frame = JSON.parse(zstdDecompressSync(input, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8')) as GatewayFrame
                if (typeof frame?.e !== 'string') return
                if (frame.e === 'logout') this.onLogout()
                this.onEvent({ type: 'gateway', frame })
            } catch (error) {
                logger.main.warn('Could not decode realtime gateway frame', { name: (error as Error)?.name })
            }
        })
        socket.connect()
        return this.snapshot()
    }

    private async reconnectAfterExpiry(socket: Socket): Promise<void> {
        if (this.socket !== socket) return
        try {
            const token = await getAuthToken()
            if (this.socket === socket && token) socket.connect()
        } catch {
            if (this.socket === socket) {
                this.scheduleAuthRetry(socket)
            }
        }
    }

    private scheduleAuthRetry(socket: Socket): void {
        if (this.socket !== socket) return
        clearTimeout(this.authRetry)
        this.authRetry = setTimeout(() => void this.reconnectAfterExpiry(socket), 15_000)
        this.authRetry.unref()
    }

    stop(): void {
        this.connectionRevision++
        clearTimeout(this.authRetry)
        const socket = this.socket
        this.socket = null
        socket?.removeAllListeners()
        socket?.disconnect()
        this.configuration = undefined
        this.sessionId = ''
        this.preferences = undefined
        this.lastTrack = ''
        this.lastMetrics = ''
        this.failures = 0
    }

    send(event: string, payload: unknown): void {
        if (!this.socket?.connected) return
        try {
            const frame = zstdCompressSync(Buffer.from(JSON.stringify({ e: event, d: payload })), {
                params: { [constants.ZSTD_c_compressionLevel]: 3 },
            })
            this.socket.emit('gw', frame)
        } catch (error) {
            logger.main.warn('Could not encode realtime gateway frame', { name: (error as Error)?.name })
        }
    }

    updateTrack(payload: unknown): void {
        this.track = normalizeTrack(this.track, payload)
        this.sendTrack()
    }

    trackPlayedEnough(payload: { realId?: unknown } | null): void {
        if (this.preferences?.trackSendingEnabled && payload) this.send('track_played_enough', { track: { id: payload.realId } })
    }

    private sendTrack(): void {
        const track = this.track
        if (!this.preferences?.trackSendingEnabled || !this.socket?.connected || !track.title || track.sourceType === 'ynison') return
        if (!['playing', 'paused'].includes(track.status ?? '')) return
        const key = JSON.stringify([track.title, track.status, track.progress?.position ?? null])
        const now = Date.now()
        if (key === this.lastTrack || now - this.lastTrackAt < 1000) return
        this.send('send_track', track)
        this.lastTrack = key
        this.lastTrackAt = now
    }

    sendMetrics(): void {
        if (!this.preferences?.metricsSendingEnabled || !this.socket?.connected) return
        const state = getState()
        const theme = state.get('addons.theme') || 'Default'
        const scripts = state.get('addons.scripts')
        const enabledScripts = new Set(Array.isArray(scripts) ? scripts : [])
        const metrics = new Map<string, { addonId: string; enabled: boolean }>()
        for (const addon of listAddonMetadata()) {
            if (addon.installSource !== 'store' || !addon.storeAddonId) continue
            const enabled = addon.type === 'theme' ? addon.directoryName === theme : enabledScripts.has(addon.directoryName)
            if (!metrics.get(addon.storeAddonId)?.enabled) metrics.set(addon.storeAddonId, { addonId: addon.storeAddonId, enabled })
        }
        const addons = [...metrics.values()].sort((a, b) => a.addonId.localeCompare(b.addonId))
        const key = JSON.stringify(addons)
        if (key === this.lastMetrics) return
        this.send('send_metrics', { addons })
        this.lastMetrics = key
    }
}

export const realtime = new DesktopRealtime()
