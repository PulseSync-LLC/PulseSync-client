import RendererEvents from '../../../../common/types/rendererEvents'
import { extractInstallModUpdateFromPayload, installModUpdateFromAsar } from '../../mod/installModUpdateFrom'

import type { Track } from '@entities/track/model/track.interface'
import type { BrowserWindow } from 'electron'
import type { Socket } from 'socket.io'

interface StateLike {
    get: (key: string) => any
    set: (key: string, value: any) => void
}

interface LoggerLike {
    http: {
        log: (...args: any[]) => void
        warn: (...args: any[]) => void
        error: (...args: any[]) => void
    }
}

interface RegisterSocketClientEventsOptions {
    socket: Socket
    state: StateLike
    logger: LoggerLike
    mainWindow: BrowserWindow
    allowedWebOrigins: readonly string[]
    getAuthorized: () => boolean
    getTrackData: () => Track
    sendDataToMusic: (options?: {
        targetSocket?: Socket
        currentAddonStateHashVersion?: number
        currentAddonStateHash?: string
        webHostAddonProtocolVersion?: number
    }) => void
    sendUserValidationToken: (targetSocket?: Socket) => Promise<void>
    updateData: (newData: any) => void
    handleBrowserAuth: (payload: any, client: Socket) => void
    handleWebDeeplink: (url: string) => Promise<boolean>
}

type WebDeeplinkAck = (result: { ok: boolean; error?: 'forbidden' | 'invalid_deeplink' | 'open_failed' }) => void

export const registerSocketClientEvents = ({
    socket,
    state,
    logger,
    mainWindow,
    allowedWebOrigins,
    getAuthorized,
    getTrackData,
    sendDataToMusic,
    sendUserValidationToken,
    updateData,
    handleBrowserAuth,
    handleWebDeeplink,
}: RegisterSocketClientEventsOptions) => {
    const sendToRenderer = (channel: string, ...args: any[]) => {
        if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
        mainWindow.webContents.send(channel, ...args)
    }

    const version = (socket.handshake.query.v as string) || state.get('mod.version')
    const clientType = (socket.handshake.query.type as string) || 'yaMusic'
    ;(socket as any).clientType = clientType
    ;(socket as any).hasPong = false

    logger.http.log(`New client connected: version=${version}, type=${clientType}`)
    socket.emit('PING', { message: 'Connected to server' })

    socket.on(
        'READY',
        async (payload?: {
            addonStateHashVersion?: number
            addonStateHash?: string
            webHostAddonProtocolVersion?: number
            userValidationProtocolVersion?: number
        }) => {
            logger.http.log('READY received from client')
            if ((socket as any).clientType !== 'yaMusic') return

            sendToRenderer(RendererEvents.CLIENT_READY)
            ;(socket as any).hasPong = true
            ;(socket as any).webHostAddonProtocolVersion = payload?.webHostAddonProtocolVersion
            ;(socket as any).userValidationProtocolVersion = payload?.userValidationProtocolVersion
            socket.emit('AUTH_STATUS', { authorized: getAuthorized() })
            if (getAuthorized()) {
                void sendUserValidationToken(socket)
                sendDataToMusic({
                    targetSocket: socket,
                    currentAddonStateHashVersion: payload?.addonStateHashVersion,
                    currentAddonStateHash: typeof payload?.addonStateHash === 'string' ? payload.addonStateHash : undefined,
                    webHostAddonProtocolVersion: payload?.webHostAddonProtocolVersion,
                })
            }
        },
    )

    socket.on('IS_PREMIUM_USER', async () => {
        logger.http.log('IS_PREMIUM_USER received')
        if (!getAuthorized()) {
            logger.http.warn('Unauthorized IS_PREMIUM_USER request, ignoring.')
        } else {
            sendToRenderer(RendererEvents.IS_PREMIUM_USER)
        }
    })

    socket.on('BROWSER_AUTH', (args: any) => {
        logger.http.log('BROWSER_AUTH received:', args)
        handleBrowserAuth(args, socket)
    })

    socket.on('BROWSER_BAN', (args: any) => {
        logger.http.log('BROWSER_BAN received:', args)
        sendToRenderer(RendererEvents.AUTH_BANNED, { reason: args.reason })
    })

    socket.on('OPEN_DEEPLINK', async (payload: { url?: unknown } | undefined, acknowledge?: WebDeeplinkAck) => {
        const origin = socket.handshake.headers.origin
        const isTrustedWebClient = clientType === 'web' && typeof origin === 'string' && allowedWebOrigins.includes(origin)
        if (!isTrustedWebClient) {
            logger.http.warn('OPEN_DEEPLINK rejected: untrusted web client')
            acknowledge?.({ ok: false, error: 'forbidden' })
            return
        }

        const url = typeof payload?.url === 'string' ? payload.url.trim() : ''
        if (!url || url.length > 4_096) {
            logger.http.warn('OPEN_DEEPLINK rejected: invalid payload')
            acknowledge?.({ ok: false, error: 'invalid_deeplink' })
            return
        }

        try {
            const opened = await handleWebDeeplink(url)
            acknowledge?.(opened ? { ok: true } : { ok: false, error: 'invalid_deeplink' })
        } catch (error) {
            logger.http.error('OPEN_DEEPLINK failed:', error)
            acknowledge?.({ ok: false, error: 'open_failed' })
        }
    })

    socket.on('UPDATE_DATA', (payload: any) => {
        if ((socket as any).clientType !== 'yaMusic') return
        logger.http.log('UPDATE_DATA received:', payload)
        updateData(payload)
    })

    socket.on('UPDATE_DOWNLOAD_INFO', (payload: any) => {
        if (!getAuthorized()) return
        logger.http.log('UPDATE_DOWNLOAD_INFO received:', payload)
        sendToRenderer(RendererEvents.TRACK_INFO, getTrackData())
    })

    socket.on('INSTALL_MOD_UPDATE_FROM', async (payload: any) => {
        if (!getAuthorized()) return
        logger.http.log('INSTALL_MOD_UPDATE_FROM received:', payload)
        const asarPath = extractInstallModUpdateFromPayload(payload)
        if (!asarPath) {
            logger.http.warn('INSTALL_MOD_UPDATE_FROM ignored: invalid payload')
            return
        }

        const result = await installModUpdateFromAsar(asarPath, mainWindow, 'socket')
        if (!result.success) {
            logger.http.warn('INSTALL_MOD_UPDATE_FROM failed:', result)
        }
    })

    socket.on(RendererEvents.SEND_TRACK, (payload: any) => {
        if (!getAuthorized()) return
        logger.http.log('SEND_TRACK received:', payload)
        sendToRenderer(RendererEvents.SEND_TRACK, payload.data)
    })

    socket.on('disconnect', () => {
        logger.http.log('Client disconnected')
        sendToRenderer(RendererEvents.TRACK_INFO, {
            type: 'refresh',
        })
    })

    socket.on('error', (err: any) => {
        logger.http.error('Socket.IO error:', err)
    })
}
