import * as http from 'http'
import { app, dialog } from 'electron'
import { selectedAddon } from '../../../index'
import { authorized } from '../../events'
import isAppDev from 'electron-is-dev'
import logger from '../logger'
import { Server as IOServer, Socket } from 'socket.io'
import trackInitials from '../../../renderer/api/initials/track.initials'
import { isFirstInstance } from '../singleInstance'
import { Track } from '../../../renderer/api/interfaces/track.interface'
import { mainWindow } from '../createWindow'
import config from '@common/appConfig'
import { getState } from '../state'
import RendererEvents from '../../../common/types/rendererEvents'
import { registerSocketClientEvents } from './events/registerSocketClientEvents'
import { registerServerIpcEvents } from './events/registerServerIpcEvents'
import { createHttpRequestHandler } from './httpRequestHandler'
import { createAddonService } from './addonService'
import { extractBrowserAuthFromPayload, processBrowserAuth } from '../auth/browserAuth'

let data: Track = trackInitials
let server: http.Server | null = null
let io: IOServer | null = null
let attempt = 0
let isStarting = false
const State = getState()

const allowedOrigins = ['music-application://desktop', 'https://dev-web.pulsesync.dev', 'https://pulsesync.dev', 'http://localhost:3000']

const addonService = createAddonService({
    state: State,
    logger,
    getIo: () => io,
    getAuthorized: () => authorized,
    getSelectedAddon: () => selectedAddon,
})

const closeServer = async (): Promise<void> => {
    const oldServer = server
    const oldIO = io

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
        getAuthorized: () => authorized,
        getTrackData: () => data,
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
            getAuthorized: () => authorized,
            getTrackData: () => data,
            sendDataToMusic: addonService.sendDataToMusic,
            updateData,
            handleBrowserAuth,
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
export const get_current_track = addonService.getCurrentTrack
export const getTrackInfo = () => data

export default server
