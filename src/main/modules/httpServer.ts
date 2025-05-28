import * as http from 'http'
import * as fs from 'original-fs'
import * as path from 'path'
import { app, dialog, ipcMain } from 'electron'
import { selectedAddon } from '../../index'
import { authorized } from '../events'
import isAppDev from 'electron-is-dev'
import logger from './logger'
import { Server as IOServer, Socket } from 'socket.io'
import trackInitials from '../../renderer/api/initials/track.initials'
import { isFirstInstance } from './singleInstance'
import config from '../../config.json'
import { store } from './storage'
import { parse } from 'url'
import { Track } from '../../renderer/api/interfaces/track.interface'
import { mainWindow } from './createWindow'

let data: Track = trackInitials
let server: http.Server | null = null
let io: IOServer | null = null
let attempt = 0
const allowedOrigins = ['music-application://desktop', 'https://dev-web.pulsesync.dev', 'https://pulsesync.dev']
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

const startSocketServer = async () => {
    if (!isFirstInstance) return

    logger.http.log('startSocketServer called. io:', !!io, 'server:', !!server)
    await closeServer()
    initializeServer()
}

const stopSocketServer = async () => {
    await closeServer()
}

const initializeServer = () => {
    server = http.createServer((req, res) => {
        const { method, url, headers } = req
        const { pathname } = parse(url || '', true)

        const origin = headers.origin as string | undefined

        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin)
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (method === 'OPTIONS') {
            res.writeHead(204)
            return res.end()
        }
        if (pathname?.startsWith('/socket.io/')) {
            return
        }

        if (method === 'GET' && pathname === '/get_handle') {
            return handleGetHandleRequest(req, res)
        }
        if (method === 'GET' && pathname === '/assets') {
            return handleGetAssetsRequest(req, res)
        }
        if (method === 'GET' && pathname?.startsWith('/assets/')) {
            return handleGetAssetFileRequest(req, res)
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
    })

    io = new IOServer(server, {
        cors: {
            origin: ['music-application://desktop', 'https://dev-web.pulsesync.dev', 'https://pulsesync.dev'],
            methods: ['GET', 'POST'],
            allowedHeaders: ['Content-Type'],
        },
    })

    io.on('connection', (socket: Socket) => {
        const version = (socket.handshake.query.v as string) || store.get('mod.version')
        const clientType = (socket.handshake.query.type as string) || 'yaMusic'
        ;(socket as any).clientType = clientType
        ;(socket as any).hasPong = false

        logger.http.log(`New client connected: version=${version}, type=${clientType}`)

        socket.emit('PING', { message: 'Connected to server' })

        socket.on('READY', () => {
            logger.http.log('READY received from client')
            if ((socket as any).clientType === 'yaMusic') {
                ;(socket as any).hasPong = true
                if (authorized) {
                    sendDataToMusic({ targetSocket: socket })
                }
            }
        })

        socket.on('BROWSER_AUTH', (args: any) => {
            logger.http.log('BROWSER_AUTH received:', args)
            handleBrowserAuth(args)
        })

        socket.on('BROWSER_BAN', (args: any) => {
            logger.http.log('BROWSER_BAN received:', args)
            mainWindow.webContents.send('authBanned', { reason: args.reason })
        })

        socket.on('UPDATE_DATA', (payload: any) => {
            if (!authorized) return
            logger.http.log('UPDATE_DATA received:', payload)
            updateData(payload)
        })

        socket.on('SEND_TRACK', (payload: any) => {
            if (!authorized) return
            logger.http.log('SEND_TRACK received:', payload)
            mainWindow.webContents.send('SEND_TRACK', payload.data)
        })

        socket.on('disconnect', () => {
            logger.http.log('Client disconnected')
            mainWindow.webContents.send('TRACK_INFO', {
                type: 'refresh',
            })
        })

        socket.on('error', (err: any) => {
            logger.http.error('Socket.IO error:', err)
        })
    })

    server.listen(config.PORT, () => {
        logger.http.log(`Socket.IO server running on port ${config.PORT}`)
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

const handleBrowserAuth = (args: any) => {
    const userId = args.userId
    fetch(`${config.SERVER_URL}/api/v1/user/${userId}/access`)
        .then(async res => {
            const j = await res.json()
            if (!j.ok || !j.access) {
                logger.deeplinkManager.error(`Access denied for user ${userId}, quitting application.`)
                return app.quit()
            }
            logger.deeplinkManager.info(`Access confirmed for user ${userId}.`)
            mainWindow.webContents.send('authSuccess')
            mainWindow.show()
        })
        .catch(error => {
            logger.deeplinkManager.error(`Error checking access for user ${userId}: ${error}`)
            app.quit()
        })

    store.set('tokens.token', args.token)
}

const handlePortInUse = () => {
    logger.http.warn(`Port ${config.PORT} is in use.`)
    if (attempt > 5) {
        dialog.showErrorBox('Error', `Failed to start server. Port ${config.PORT} is in use.`)
        return app.quit()
    }
    attempt++
    setTimeout(() => {
        server?.close()
        server?.listen(config.PORT, () => {
            logger.http.log(`Server restarted on port ${config.PORT}`)
            attempt = 0
        })
    }, 1000)
}

export const setAddon = (theme: string) => {
    if (!authorized || !io) return

    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const themePath = path.join(themesPath, selectedAddon)
    const metadataPath = path.join(themePath, 'metadata.json')
    if (!fs.existsSync(metadataPath)) return

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    const cssPath = path.join(themePath, metadata.css || '')
    const jsPath = metadata.script ? path.join(themePath, metadata.script) : null
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
    const js = jsPath && fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''
    console.log('test: ' + selectedAddon)
    const themeData = { name: selectedAddon, css: css || '{}', script: js || '' }
    if ((!metadata.type || (metadata.type !== 'theme' && metadata.type !== 'script')) && metadata.name !== 'Default') {
        return
    }

    const waitForSocket = new Promise<void>(resolve => {
        const interval = setInterval(() => {
            if (io && io.engine.clientsCount > 0) {
                clearInterval(interval)
                resolve()
            }
        }, 100)
    })

    waitForSocket.then(() => {
        io!.sockets.sockets.forEach(sock => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
                sock.emit('THEME', {
                    theme: themeData,
                })
            }
        })
    })
}

export const sendAddon = (withJs: boolean, themeDef?: boolean) => {
    if (!io) return

    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const themeFolder = themeDef ? 'Default' : store.get('addons.theme') || 'Default'
    const themePath = path.join(themesPath, themeFolder)
    const metadataPath = path.join(themePath, 'metadata.json')
    if (!fs.existsSync(metadataPath)) return

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    const cssPath = path.join(themePath, metadata.css || '')
    const jsPath = metadata.script ? path.join(themePath, metadata.script) : null
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
    const js = jsPath && fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''

    const themeData = {
        name: themeDef ? 'Default' : store.get('addons.theme') || 'Default',
        css: css || '{}',
        script: js || '',
    }
    io.sockets.sockets.forEach(sock => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            if (withJs)
                sock.emit('THEME', {
                    theme: themeData,
                })
            else
                sock.emit('UPDATE_CSS', {
                    theme: {
                        css: themeData.css,
                        name: themeData.name,
                    },
                })
        }
    })
}

export const sendExtensions = async (): Promise<void> => {
    if (!io) return

    let scripts = store.get('addons.scripts')
    if (!scripts) {
        return
    }
    if (typeof scripts === 'string') {
        scripts = scripts
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
    } else if (!Array.isArray(scripts)) {
        scripts = []
    }

    const addonsFolder = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    let dirs: string[] = []
    try {
        dirs = fs.readdirSync(addonsFolder)
    } catch (err) {
        return
    }

    const found = dirs
        .map(folderName => {
            const metadataPath = path.join(addonsFolder, folderName, 'metadata.json')
            if (!fs.existsSync(metadataPath)) {
                return null
            }
            try {
                const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
                const metaName = typeof meta.name === 'string' ? meta.name.trim() : ''
                const addonName = metaName || folderName

                const folderMatches = scripts.includes(folderName)
                const nameMatches = metaName.length > 0 && scripts.includes(metaName)
                if (!folderMatches && !nameMatches) return null
                if ((!meta.type || (meta.type !== 'theme' && meta.type !== 'script')) && folderName !== 'Default') {
                    return null
                }

                let css: string | null = null
                if (meta.css) {
                    const cssPath = path.join(addonsFolder, folderName, meta.css)
                    if (fs.existsSync(cssPath)) {
                        css = fs.readFileSync(cssPath, 'utf8')
                    }
                }
                let script: string | null = null
                if (meta.script) {
                    const jsPath = path.join(addonsFolder, folderName, meta.script)
                    if (fs.existsSync(jsPath)) {
                        script = fs.readFileSync(jsPath, 'utf8')
                    }
                }

                return {
                    name: folderMatches ? folderName : addonName,
                    css,
                    script,
                }
            } catch (err) {
                return null
            }
        })
        .filter((x): x is { name: string; css: string | null; script: string | null } => Boolean(x))

    io.sockets.sockets.forEach(sock => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            sock.emit('REFRESH_EXTENSIONS', { addons: found })
        }
    })
}

interface DataToMusicOptions {
    targetSocket?: Socket
}
const sendDataToMusic = ({ targetSocket }: DataToMusicOptions = {}) => {
    const sendOnce = (sock: Socket) => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            sendAddon(true, true)
            sock.emit('REFRESH_EXTENSIONS', { addons: [] })
            logger.http.log('Data sent after READY')
        }
    }

    if (targetSocket) sendOnce(targetSocket)
    else io!.sockets.sockets.forEach(sendOnce)

    setTimeout(async () => {
        io!.sockets.sockets.forEach(sock => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
                sendAddon(true)
            }
        })
        await sendExtensions()
    }, 1000)
}

ipcMain.on('WEBSOCKET_START', async () => {
    if (isAppDev && !store.get('settings.devSocket')) return
    logger.http.log('WEBSOCKET_START: starting server...')
    await startSocketServer()
})
ipcMain.on('WEBSOCKET_STOP', async () => {
    logger.http.log('WEBSOCKET_STOP: stopping server...')
    await stopSocketServer()
})
ipcMain.on('WEBSOCKET_RESTART', async () => {
    logger.http.log('WEBSOCKET_RESTART: restarting server...')
    await stopSocketServer()
    setTimeout(() => startSocketServer(), 1500)
})
ipcMain.on('REFRESH_MOD_INFO', () => {
    logger.http.log('REFRESH_MOD_INFO: forcing data send...')
    sendDataToMusic()
})
ipcMain.on('REFRESH_EXTENSIONS', async () => {
    await sendExtensions()
})
ipcMain.on('GET_TRACK_INFO', () => {
    logger.http.log('GET_TRACK_INFO: returning current track...')
    io?.sockets.sockets.forEach(sock => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            sock.emit('GET_TRACK_INFO')
        }
    })
})

const handleGetHandleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const { query } = parse(req.url || '', true)
        const name = query.name as string
        if (!name) return sendNotFound(res, 'Handle events data not found')
        const p = path.join(app.getPath('appData'), 'PulseSync', 'addons', name, 'handleEvents.json')
        if (fs.existsSync(p)) {
            const d = JSON.parse(fs.readFileSync(p, 'utf8'))
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: true, data: d }))
        }
        sendNotFound(res, 'Handle events data not found')
    } catch (err) {
        logger.http.error('Error reading handle events:', err)
        sendServerError(res, 'Error reading handle events')
    }
}
const handleGetAssetsRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const themePath = path.join(themesPath, selectedAddon)
        const assets = path.join(themePath, 'Assets')
        if (fs.existsSync(assets)) {
            const files = getFilesInDirectory(assets)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: true, themePath, assetsPath: assets, files }))
        }
        sendNotFound(res, 'Assets folder not found')
    } catch (err) {
        logger.http.error('Error reading assets:', err)
        sendServerError(res, 'Error reading assets')
    }
}
const handleGetAssetFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const themePath = path.join(themesPath, selectedAddon)
        const assets = path.join(themePath, 'Assets')
        const fn = req.url!.substring('/assets/'.length)
        const fp = getFilePathInAssets(fn, assets)
        if (fp) {
            const ext = path.extname(fp).slice(1)
            const mimes: Record<string, string> = {
                jpg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                ico: 'image/x-icon',
            }
            res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' })
            return fs.createReadStream(fp).pipe(res)
        }
        sendNotFound(res, 'File not found')
    } catch (err) {
        logger.http.error('Error serving asset file:', err)
        sendServerError(res, 'Error serving asset file')
    }
}

const getFilesInDirectory = (dir: string): Record<string, string> =>
    fs.readdirSync(dir).reduce(
        (acc, f) => {
            const fp = path.join(dir, f)
            if (fs.statSync(fp).isDirectory()) Object.assign(acc, getFilesInDirectory(fp))
            else acc[f] = fp
            return acc
        },
        {} as Record<string, string>,
    )

const findFileInDirectory = (filename: string, dir: string): string | null => {
    for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f)
        if (fs.statSync(fp).isDirectory()) {
            const res = findFileInDirectory(filename, fp)
            if (res) return res
        } else if (path.basename(fp) === filename) {
            return fp
        }
    }
    return null
}

const getFilePathInAssets = (fn: string, assets: string): string | null => {
    const fp = findFileInDirectory(fn, assets)
    logger.http.log('File Path:', fp)
    return fp
}

const sendNotFound = (res: http.ServerResponse, msg: string) => {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: msg }))
}

const sendServerError = (res: http.ServerResponse, msg: string) => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: msg }))
}

const updateData = (newData: any) => {
    if (newData.type === 'refresh') {
        return mainWindow.webContents.send('TRACK_INFO', {
            type: 'refresh',
        })
    }
    data = newData
    console.log('Data updated:', data)
    mainWindow.webContents.send('TRACK_INFO', data)
}

export const getTrackInfo = () => data
export default server
