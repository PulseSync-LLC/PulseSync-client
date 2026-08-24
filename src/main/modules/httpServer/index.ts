import { app, BrowserWindow, dialog } from 'electron'

import * as http from 'http'
import { Server as IOServer } from 'socket.io'

import config from '@common/appConfig'
import trackInitials from '@entities/track/model/track.initials'

import RendererEvents from '../../../common/types/rendererEvents'
import { authorized } from '../../events'
import mainHttpClient from '../../http/client'
import { selectedAddon } from '../../startup/runtimeState'
import isAppDev from '../../utils/isAppDev'
import { extractBrowserAuthFromPayload, processBrowserAuth } from '../auth/browserAuth'
import { mainWindow } from '../createWindow'
import { checkIsDeeplink, createDeeplinkCommandsHandler, navigateToDeeplink } from '../handleDeeplinks'
import logger from '../logger'
import { isFirstInstance } from '../singleInstance'
import { getState } from '../state'
import { createAddonService } from './addonService'
import { registerServerIpcEvents } from './events/registerServerIpcEvents'
import { registerSocketClientEvents } from './events/registerSocketClientEvents'
import { createHttpRequestHandler } from './httpRequestHandler'

import type { Track } from '@entities/track/model/track.interface'
import type { Socket } from 'socket.io'

let data: Track = trackInitials
let server: http.Server | null = null
let io: IOServer | null = null
let attempt = 0
let isStarting = false
const State = getState()
const USER_VALIDATION_TOKEN_REFRESH_WINDOW_MS = 6 * 60 * 1000
const USER_VALIDATION_TOKEN_RETRY_DELAY_MS = 60 * 1000

type UserValidationToken = {
    token: string
    expiresAt: number
}

let cachedUserValidationToken: (UserValidationToken & { authToken: string }) | null = null
let userValidationTokenGeneration = 0
let userValidationTokenRequest: { authToken: string; promise: Promise<UserValidationToken | null> } | null = null
let userValidationTokenRefreshTimer: ReturnType<typeof setTimeout> | null = null

const allowedOrigins = [
    'music-application://desktop',
    'https://dev-web.pulsesync.dev',
    'https://pulsesync.dev',
    'http://localhost:3000',
    'http://localhost:3100',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3100',
]
const allowedWebOrigins = allowedOrigins.filter(origin => origin.startsWith('http://') || origin.startsWith('https://'))
let deeplinkCommandsHandlerPromise: ReturnType<typeof createDeeplinkCommandsHandler> | null = null

const addonService = createAddonService({
    state: State,
    logger,
    getIo: () => io,
    getAuthorized: () => authorized,
    getSelectedAddon: () => selectedAddon,
})

const handleWebDeeplink = async (url: string): Promise<boolean> => {
    if (!checkIsDeeplink(url)) return false

    deeplinkCommandsHandlerPromise ??= createDeeplinkCommandsHandler()
    const deeplinkCommandsHandler = await deeplinkCommandsHandlerPromise
    const targetWindow = !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows().find(window => !window.isDestroyed())

    await navigateToDeeplink(url, deeplinkCommandsHandler, targetWindow)

    if (targetWindow) {
        if (targetWindow.isMinimized()) targetWindow.restore()
        targetWindow.show()
        targetWindow.focus()
    }

    return true
}

const getUserValidationToken = async (): Promise<UserValidationToken | null> => {
    const authToken = State.get('tokens.token')
    if (!authorized || typeof authToken !== 'string' || !authToken) return null

    if (
        cachedUserValidationToken?.authToken === authToken &&
        cachedUserValidationToken.expiresAt - Date.now() > USER_VALIDATION_TOKEN_REFRESH_WINDOW_MS
    ) {
        return cachedUserValidationToken
    }
    if (userValidationTokenRequest?.authToken === authToken) return userValidationTokenRequest.promise

    const generation = userValidationTokenGeneration
    const promise = (async (): Promise<UserValidationToken | null> => {
        try {
            const response = await mainHttpClient.post<{ ok?: boolean; token?: string; expiresAt?: number }>('/user/validation/token', {
                authToken,
                timeoutMs: 5000,
            })
            const token = typeof response.data?.token === 'string' ? response.data.token : ''
            const expiresAt = Number(response.data?.expiresAt)
            if (!response.ok || response.data?.ok !== true || !token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
                return null
            }
            if (generation !== userValidationTokenGeneration || State.get('tokens.token') !== authToken || !authorized) return null

            cachedUserValidationToken = { authToken, token, expiresAt }
            return { token, expiresAt }
        } catch (error) {
            logger.http.warn('Failed to request user validation token:', error)
            return null
        }
    })()

    userValidationTokenRequest = { authToken, promise }
    try {
        return await promise
    } finally {
        if (userValidationTokenRequest?.promise === promise) userValidationTokenRequest = null
    }
}

const clearUserValidationTokenRefreshTimer = (): void => {
    if (!userValidationTokenRefreshTimer) return
    clearTimeout(userValidationTokenRefreshTimer)
    userValidationTokenRefreshTimer = null
}

const scheduleUserValidationTokenRefresh = (delayMs: number): void => {
    clearUserValidationTokenRefreshTimer()
    userValidationTokenRefreshTimer = setTimeout(
        () => {
            userValidationTokenRefreshTimer = null
            if (authorized) void sendUserValidationToken()
        },
        Math.max(USER_VALIDATION_TOKEN_RETRY_DELAY_MS, delayMs),
    )
}

const sendUserValidationToken = async (targetSocket?: Socket): Promise<void> => {
    if (!authorized || !io) return

    const sockets = (targetSocket ? [targetSocket] : Array.from(io.sockets.sockets.values())).filter(socket => {
        const client = socket as any
        return socket.connected && client.clientType === 'yaMusic' && client.hasPong
    })
    if (!sockets.length) return

    const token = await getUserValidationToken()
    if (!token) {
        if (authorized && io) scheduleUserValidationTokenRefresh(USER_VALIDATION_TOKEN_RETRY_DELAY_MS)
        return
    }
    if (!authorized || !io) return

    sockets.forEach(socket => {
        const client = socket as any
        if (socket.connected && client.clientType === 'yaMusic' && client.hasPong) {
            socket.emit('USER_VALIDATION_TOKEN', token)
        }
    })
    scheduleUserValidationTokenRefresh(token.expiresAt - Date.now() - USER_VALIDATION_TOKEN_REFRESH_WINDOW_MS)
}

const closeServer = async (): Promise<void> => {
    const oldServer = server
    const oldIO = io
    clearUserValidationTokenRefreshTimer()

    return new Promise(resolve => {
        if (oldIO) {
            oldIO.close()
            io = null
        }
        if (oldServer) {
            oldServer.close(() => {
                logger.http.log('HTTP server closed.')
                if (server === oldServer) {
                    server = null
                }
                resolve()
            })
        } else {
            resolve()
        }
    })
}

const initializeServer = () => {
    const handleHttpRequest = createHttpRequestHandler({
        logger,
        allowedOrigins,
        getTrackData: () => data,
        reloadDevelopmentAddon: addonService.reloadDevelopmentAddon,
    })

    server = http.createServer(handleHttpRequest)
    io = new IOServer(server, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            allowedHeaders: ['Content-Type'],
        },
    })

    io.on('connection', (socket: Socket) => {
        registerSocketClientEvents({
            socket,
            state: State,
            logger,
            mainWindow,
            allowedWebOrigins,
            getAuthorized: () => authorized,
            getTrackData: () => data,
            sendDataToMusic: addonService.sendDataToMusic,
            sendUserValidationToken,
            updateData,
            handleBrowserAuth,
            handleWebDeeplink,
        })
    })

    server.listen(config.MAIN_PORT, () => {
        logger.http.log(`Socket.IO server running on port ${config.MAIN_PORT}`)
        attempt = 0
    })

    server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
            handlePortInUse()
        } else {
            logger.http.error('HTTP server error:', error)
        }
    })
}

const startSocketServer = async () => {
    if (!isFirstInstance) return

    if (io && server) {
        logger.http.log('startSocketServer skipped: already running')
        return
    }
    if (isStarting) {
        logger.http.log('startSocketServer skipped: already starting')
        return
    }

    isStarting = true
    logger.http.log('startSocketServer called. io:', !!io, 'server:', !!server)
    try {
        await closeServer()
        initializeServer()
    } finally {
        isStarting = false
    }
}

const stopSocketServer = async () => {
    await closeServer()
}

const handleBrowserAuth = async (payload: any, client: Socket) => {
    const credentials = extractBrowserAuthFromPayload(payload)
    if (!credentials) {
        logger.socketManager.error('Invalid authentication data received from browser.')
        app.quit()
        return
    }
    await processBrowserAuth(credentials, { window: mainWindow, client })
}

const handlePortInUse = () => {
    logger.http.warn(`Port ${config.MAIN_PORT} is in use.`)
    if (attempt > 5) {
        dialog.showErrorBox('Error', `Failed to start server. Port ${config.MAIN_PORT} is in use.`)
        return app.quit()
    }

    attempt++
    setTimeout(() => {
        server?.close()
        server?.listen(config.MAIN_PORT, () => {
            logger.http.log(`Server restarted on port ${config.MAIN_PORT}`)
            attempt = 0
        })
    }, 1000)
}

registerServerIpcEvents({
    isAppDev,
    state: State,
    logger,
    startSocketServer,
    stopSocketServer,
    sendDataToMusic: () => addonService.sendDataToMusic(),
    sendExtensions: addonService.sendExtensions,
    sendPremiumUserToClients: addonService.sendPremiumUserToClients,
    getCurrentTrack: addonService.getCurrentTrack,
})

const updateData = (newData: any) => {
    if (newData.type === 'refresh') {
        return mainWindow.webContents.send(RendererEvents.TRACK_INFO, {
            type: 'refresh',
        })
    }
    data = newData
    mainWindow.webContents.send(RendererEvents.TRACK_INFO, data)
}

export const getAllAllowedUrls = addonService.getAllAllowedUrls
export const setAddon = addonService.setAddon
export const sendAddon = addonService.sendAddon
export const sendExtensions = addonService.sendExtensions
export const sendAddonSettings = addonService.sendAddonSettings
export const sendAllAddonSettings = addonService.sendAllAddonSettings
export const get_current_track = addonService.getCurrentTrack
export const sendAuthorizationStatus = (isAuthorized: boolean): void => {
    if (!isAuthorized) {
        userValidationTokenGeneration += 1
        cachedUserValidationToken = null
        clearUserValidationTokenRefreshTimer()
    }
    if (!io) return
    io.sockets.sockets.forEach(socket => {
        const client = socket as any
        if (client.clientType === 'yaMusic' && client.hasPong) {
            socket.emit('AUTH_STATUS', { authorized: isAuthorized })
        }
    })
    if (isAuthorized) {
        addonService.sendDataToMusic()
        void sendUserValidationToken()
    }
}
export const getTrackInfo = () => data

export default server
