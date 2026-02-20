import MainEvents from '../../../../common/types/mainEvents'
import { ipcMain } from 'electron'

interface StateLike {
    get: (key: string) => any
}

interface LoggerLike {
    http: {
        log: (...args: any[]) => void
    }
}

interface RegisterServerIpcEventsOptions {
    isAppDev: boolean
    state: StateLike
    logger: LoggerLike
    startSocketServer: () => Promise<void>
    stopSocketServer: () => Promise<void>
    sendDataToMusic: () => void
    sendExtensions: () => Promise<void>
    sendPremiumUserToClients: (args: any) => void
    getCurrentTrack: () => void
}

export const registerServerIpcEvents = ({
    isAppDev,
    state,
    logger,
    startSocketServer,
    stopSocketServer,
    sendDataToMusic,
    sendExtensions,
    sendPremiumUserToClients,
    getCurrentTrack,
}: RegisterServerIpcEventsOptions) => {
    ipcMain.on(MainEvents.WEBSOCKET_START, async () => {
        if (isAppDev && !state.get('settings.devSocket')) return
        logger.http.log('WEBSOCKET_START: starting server...')
        await startSocketServer()
    })

    ipcMain.on(MainEvents.WEBSOCKET_STOP, async () => {
        logger.http.log('WEBSOCKET_STOP: stopping server...')
        await stopSocketServer()
    })

    ipcMain.on(MainEvents.WEBSOCKET_RESTART, async () => {
        logger.http.log('WEBSOCKET_RESTART: restarting server...')
        await stopSocketServer()
        setTimeout(() => startSocketServer(), 1500)
    })

    ipcMain.on(MainEvents.REFRESH_MOD_INFO, () => {
        logger.http.log('REFRESH_MOD_INFO: forcing data send...')
        sendDataToMusic()
    })

    ipcMain.on(MainEvents.REFRESH_EXTENSIONS, async () => {
        await sendExtensions()
    })

    ipcMain.on(MainEvents.SEND_PREMIUM_USER, (_event, args) => {
        logger.http.log('SEND_PREMIUM_USER received:', args.ok)
        if (!args.ok) return
        sendPremiumUserToClients(args)
    })

    ipcMain.on(MainEvents.GET_TRACK_INFO, () => {
        logger.http.log('GET_TRACK_INFO: returning current track...')
        getCurrentTrack()
    })
}
