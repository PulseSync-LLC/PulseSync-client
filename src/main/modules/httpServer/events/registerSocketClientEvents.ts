import RendererEvents from '../../../../common/types/rendererEvents'
import { Track } from '../../../../renderer/api/interfaces/track.interface'
import { Socket } from 'socket.io'

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

interface MainWindowLike {
    webContents: {
        send: (channel: string, ...args: any[]) => void
    }
}

interface RegisterSocketClientEventsOptions {
    socket: Socket
    state: StateLike
    logger: LoggerLike
    mainWindow: MainWindowLike
    t: (key: string) => string
    setRpcStatus: (status: boolean) => void
    getAuthorized: () => boolean
    getTrackData: () => Track
    sendDataToMusic: (options?: { targetSocket?: Socket }) => void
    updateData: (newData: any) => void
    handleBrowserAuth: (payload: any, client: Socket) => void
    getDrpcV2SupportedSocketId: () => string | null
    setDrpcV2SupportedSocketId: (id: string | null) => void
}

export const registerSocketClientEvents = ({
    socket,
    state,
    logger,
    mainWindow,
    t,
    setRpcStatus,
    getAuthorized,
    getTrackData,
    sendDataToMusic,
    updateData,
    handleBrowserAuth,
    getDrpcV2SupportedSocketId,
    setDrpcV2SupportedSocketId,
}: RegisterSocketClientEventsOptions) => {
    const version = (socket.handshake.query.v as string) || state.get('mod.version')
    const clientType = (socket.handshake.query.type as string) || 'yaMusic'
    ;(socket as any).clientType = clientType
    ;(socket as any).hasPong = false

    logger.http.log(`New client connected: version=${version}, type=${clientType}`)
    socket.emit('PING', { message: 'Connected to server' })

    socket.on('READY', async () => {
        logger.http.log('READY received from client')
        if ((socket as any).clientType !== 'yaMusic') return

        mainWindow.webContents.send(RendererEvents.CLIENT_READY)
        ;(socket as any).hasPong = true
        if (getAuthorized()) {
            sendDataToMusic({ targetSocket: socket })
        }
    })

    socket.on('IS_DRPCV2_SUPPORTED', () => {
        logger.http.log('IS_DRPCV2_SUPPORTED received, responding with support status.')
        socket.emit('DRPCV2_SUPPORTED')

        setDrpcV2SupportedSocketId(socket.id)
        state.set('discordRpc.lockedByDrpcV2', true)

        if (state.get('discordRpc.status')) {
            logger.http.log('DRPCV2 is supported by client, disabling built-in Discord RPC.')
            mainWindow.webContents.send(RendererEvents.RPC_LOG, {
                message: t('main.discordRpc.disabledByDrpcV2'),
                type: 'info',
            })
            setRpcStatus(false)
        }
    })

    socket.on('IS_PREMIUM_USER', async () => {
        logger.http.log('IS_PREMIUM_USER received')
        if (!getAuthorized()) {
            logger.http.warn('Unauthorized IS_PREMIUM_USER request, ignoring.')
        } else {
            mainWindow.webContents.send(RendererEvents.IS_PREMIUM_USER)
        }
    })

    socket.on('BROWSER_AUTH', (args: any) => {
        logger.http.log('BROWSER_AUTH received:', args)
        handleBrowserAuth(args, socket)
    })

    socket.on('BROWSER_BAN', (args: any) => {
        logger.http.log('BROWSER_BAN received:', args)
        mainWindow.webContents.send(RendererEvents.AUTH_BANNED, { reason: args.reason })
    })

    socket.on('UPDATE_DATA', (payload: any) => {
        if (!getAuthorized()) return
        logger.http.log('UPDATE_DATA received:', payload)
        updateData(payload)
    })

    socket.on('UPDATE_DOWNLOAD_INFO', (payload: any) => {
        if (!getAuthorized()) return
        logger.http.log('UPDATE_DOWNLOAD_INFO received:', payload)
        mainWindow.webContents.send(RendererEvents.TRACK_INFO, getTrackData())
    })

    socket.on(RendererEvents.SEND_TRACK, (payload: any) => {
        if (!getAuthorized()) return
        logger.http.log('SEND_TRACK received:', payload)
        mainWindow.webContents.send(RendererEvents.SEND_TRACK, payload.data)
    })

    socket.on('disconnect', () => {
        logger.http.log('Client disconnected')
        if (getDrpcV2SupportedSocketId() === socket.id) {
            setDrpcV2SupportedSocketId(null)
            state.set('discordRpc.lockedByDrpcV2', false)
        }
        mainWindow.webContents.send(RendererEvents.TRACK_INFO, {
            type: 'refresh',
        })
    })

    socket.on('error', (err: any) => {
        logger.http.error('Socket.IO error:', err)
    })
}
