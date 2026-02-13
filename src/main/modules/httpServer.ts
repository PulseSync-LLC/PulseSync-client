import * as http from 'http'
import * as fs from 'original-fs'
import * as path from 'path'
import { app, dialog, ipcMain } from 'electron'
import MainEvents from '../../common/types/mainEvents'
import RendererEvents from '../../common/types/rendererEvents'
import { selectedAddon } from '../../index'
import { authorized } from '../events'
import isAppDev from 'electron-is-dev'
import logger from './logger'
import { Server as IOServer, Socket } from 'socket.io'
import trackInitials from '../../renderer/api/initials/track.initials'
import { isFirstInstance } from './singleInstance'
import { parse } from 'url'
import { Track } from '../../renderer/api/interfaces/track.interface'
import { mainWindow } from './createWindow'
import config from '@common/appConfig'
import { getState } from './state'
import { sanitizeScript } from '../utils/addonUtils'
import axios from 'axios'
import { resolveBasePaths } from './mod/mod-files'
import crypto from 'node:crypto'

let data: Track = trackInitials
let server: http.Server | null = null
let io: IOServer | null = null
let attempt = 0
let isStarting = false
const State = getState()

const allowedOrigins = ['music-application://desktop', 'https://dev-web.pulsesync.dev', 'https://pulsesync.dev', 'http://localhost:3000']

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

export function getAllAllowedUrls(): string[] {
    const addonsFolder = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const urls = new Set<string>()

    let folders: string[] = []
    try {
        folders = fs.readdirSync(addonsFolder)
    } catch {
        return []
    }

    const stateTheme = State.get('addons.theme')
    const themeFolder =
        typeof stateTheme === 'string' && stateTheme.trim()
            ? stateTheme.trim()
            : typeof selectedAddon === 'string' && selectedAddon.trim()
              ? selectedAddon.trim()
              : 'Default'

    const themeMetaPath = path.join(addonsFolder, themeFolder, 'metadata.json')
    if (fs.existsSync(themeMetaPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(themeMetaPath, 'utf8'))
            if (Array.isArray((meta as any).allowedUrls)) {
                ;(meta as any).allowedUrls.forEach((u: unknown) => {
                    if (typeof u === 'string' && u.trim()) {
                        urls.add(u.trim())
                    }
                })
            }
        } catch {}
    }

    let scripts = State.get('addons.scripts')
    if (typeof scripts === 'string') {
        scripts = scripts
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
    }
    if (!Array.isArray(scripts)) scripts = []

    for (const folder of folders) {
        if (!scripts.includes(folder)) continue
        const metaPath = path.join(addonsFolder, folder, 'metadata.json')
        if (!fs.existsSync(metaPath)) continue
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
            if (Array.isArray((meta as any).allowedUrls)) {
                ;(meta as any).allowedUrls.forEach((u: unknown) => {
                    if (typeof u === 'string' && u.trim()) {
                        urls.add(u.trim())
                    }
                })
            }
        } catch {}
    }

    return Array.from(urls)
}

const handleGetHandleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const { query } = parse(req.url || '', true)
        const name = query.name as string

        if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Missing query parameters: name or type' }))
        }

        const basePath = path.join(app.getPath('appData'), 'PulseSync', 'addons', name)
        const handlePath = path.join(basePath, 'handleEvents.json')

        if (fs.existsSync(handlePath)) {
            const d = JSON.parse(fs.readFileSync(handlePath, 'utf8'))
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: true, data: d }))
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Handle events data not found' }))
        }
    } catch (err) {
        logger.http.error('Error processing get_handle:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
    }
}

const findAssetsDirectory = (basePath: string): string | null => {
    const candidates = ['Assets', 'assets']
    for (const folderName of candidates) {
        const dirPath = path.join(basePath, folderName)
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
            return dirPath
        }
    }
    return null
}

const handleGetAssetsRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const { query } = parse(req.url || '', true)
        const name = query.name as string

        if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Missing query parameter: name' }))
        }

        const addonsPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const addonPath = path.join(addonsPath, name)
        const assetsDir = findAssetsDirectory(addonPath)

        if (assetsDir) {
            const files = getFilesInDirectory(assetsDir)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: true, addonPath, assetsPath: assetsDir, files }))
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Assets folder not found' }))
        }
    } catch (err) {
        logger.http.error('Error reading assets:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Error reading assets' }))
    }
}

const handleGetAssetFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const { pathname, query } = parse(req.url || '', true)
        const name = query.name as string

        if (!name) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Missing query parameter: name' }))
        }

        const addonsPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const addonPath = path.join(addonsPath, name)
        const assetsDir = findAssetsDirectory(addonPath)

        if (!assetsDir) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Assets folder not found' }))
        }

        const fn = pathname!.substring('/assets/'.length)
        const fp = getFilePathInAssets(fn, assetsDir)

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
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'File not found' }))
        }
    } catch (err) {
        logger.http.error('Error serving asset file:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Error serving asset file' }))
    }
}
const handleGetAddonRootFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        const { query } = parse(req.url || '', true)
        const name = query.name as string
        const fileName = query.file as string

        if (!name || !fileName) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Missing query parameters: name or file' }))
        }
        if (/^https?:\/\//i.test(fileName)) {
            logger.http.log(`Skipping remote URL for root file: ${fileName}`)
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ ok: false, error: 'Remote URLs are not served by this endpoint.' }))
        }
        const addonsPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const addonPath = path.join(addonsPath, name)
        const targetPath = path.join(addonPath, fileName)

        console.info(`Looking for addon root file: ${targetPath}`)

        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
            const ext = path.extname(targetPath).slice(1)
            const mimes: Record<string, string> = {
                jpg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                svg: 'image/svg+xml',
                ico: 'image/x-icon',
            }
            res.writeHead(200, {
                'Content-Type': mimes[ext] || 'application/octet-stream',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
                'Surrogate-Control': 'no-store',
            })
            return fs.createReadStream(targetPath).pipe(res)
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'File not found in addon root' }))
        }
    } catch (err) {
        logger.socketManager.error('Error serving addon root file:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Error serving addon root file' }))
    }
}

const handleGetTrack = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
        if (!authorized) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Unauthorized' }))
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(data))
    } catch (err) {
        logger.http.error('Error processing get_track:', err)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
    }
}

const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
    '/get_handle': handleGetHandleRequest,
    '/assets': handleGetAssetsRequest,
    '/addon_file': handleGetAddonRootFileRequest,
    '/get_track': handleGetTrack,
}

const assetPrefix = '/assets/'

const initializeServer = () => {
    server = http.createServer((req, res) => {
        const { method, url, headers } = req
        const { pathname } = parse(url || '', true)
        const origin = headers.origin as string | undefined

        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin)
        }
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT')
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers',
        )

        if (method === 'OPTIONS') {
            res.writeHead(204)
            return res.end()
        }
        if (pathname?.startsWith('/socket.io/')) {
            return
        }

        if (method === 'GET') {
            if (pathname && routes[pathname]) {
                return routes[pathname](req, res)
            }
            if (pathname && pathname.startsWith(assetPrefix)) {
                return handleGetAssetFileRequest(req, res)
            }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
    })

    io = new IOServer(server, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            allowedHeaders: ['Content-Type'],
        },
    })

    io.on('connection', (socket: Socket) => {
        const version = (socket.handshake.query.v as string) || State.get('mod.version')
        const clientType = (socket.handshake.query.type as string) || 'yaMusic'
        ;(socket as any).clientType = clientType
        ;(socket as any).hasPong = false

        logger.http.log(`New client connected: version=${version}, type=${clientType}`)

        socket.emit('PING', { message: 'Connected to server' })

        socket.on('READY', async () => {
            logger.http.log('READY received from client')
            if ((socket as any).clientType === 'yaMusic') {
                // if (!(await checkAsarChecksum()) && !isAppDev) {
                //     logger.http.warn('Client mod checksum mismatch, disconnecting client.')
                //     socket.disconnect(true)
                //     return
                // }
                mainWindow.webContents.send(RendererEvents.CLIENT_READY)
                ;(socket as any).hasPong = true
                if (authorized) {
                    sendDataToMusic({ targetSocket: socket })
                }
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
            if (!authorized) return
            logger.http.log('UPDATE_DATA received:', payload)
            updateData(payload)
        })

        socket.on('UPDATE_DOWNLOAD_INFO', (payload: any) => {
            if (!authorized) return
            logger.http.log('UPDATE_DOWNLOAD_INFO received:', payload)
            mainWindow.webContents.send(RendererEvents.TRACK_INFO, data)
        })

        socket.on(RendererEvents.SEND_TRACK, (payload: any) => {
            if (!authorized) return
            logger.http.log('SEND_TRACK received:', payload)
            mainWindow.webContents.send(RendererEvents.SEND_TRACK, payload.data)
        })

        socket.on('disconnect', () => {
            logger.http.log('Client disconnected')
            mainWindow.webContents.send(RendererEvents.TRACK_INFO, {
                type: 'refresh',
            })
        })

        socket.on('error', (err: any) => {
            logger.http.error('Socket.IO error:', err)
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
const checkAsarChecksum = async (): Promise<boolean> => {
    const basePaths = await resolveBasePaths()
    const asarPath = basePaths.modAsar
    const buf = fs.readFileSync(asarPath)
    const currentHash = crypto.createHash('sha256').update(buf).digest('hex')
    const savedChecksum = State.get('mod.checksum')
    return currentHash === savedChecksum
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

const handleBrowserAuth = async (payload: any, client: Socket) => {
    const { userId, token } = payload.args

    if (!userId || !token) {
        logger.socketManager.error('Invalid authentication data received from browser.')
        return app.quit()
    }
    try {
        if (isAppDev) {
            State.set('tokens.token', token)
            mainWindow.webContents.send(RendererEvents.AUTH_SUCCESS)
            mainWindow.show()
            return
        }
        const { data } = await axios.get(`${config.SERVER_URL}/api/v1/user/${userId}/access`)
        if (!data.ok || !data.access) {
            logger.socketManager.error(`Access denied for user ${userId}, quitting application.`)
            return app.quit()
        }
        State.set('tokens.token', token)
        logger.socketManager.info(`Access confirmed for user ${userId}.`)
        mainWindow.webContents.send(RendererEvents.AUTH_SUCCESS)
        client.send(RendererEvents.AUTH_SUCCESS)
        mainWindow.show()
    } catch (error) {
        logger.socketManager.error(`Error processing authentication for user ${userId}: ${error}`)
        app.quit()
    }
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
    let js = jsPath && fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''
    js = sanitizeScript(js)

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
                    allowedUrls: getAllAllowedUrls(),
                })
                sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            }
        })
    })
}

export const sendAddon = (withJs: boolean, themeDef?: boolean) => {
    if (!io) return

    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    const themeFolder = themeDef ? 'Default' : State.get('addons.theme') || 'Default'
    const themePath = path.join(themesPath, themeFolder)
    const metadataPath = path.join(themePath, 'metadata.json')
    if (!fs.existsSync(metadataPath)) return

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    let css = ''
    let js = ''

    const cssPath = path.join(themePath, metadata.css || '')
    if (metadata.css && fs.existsSync(cssPath) && fs.statSync(cssPath).isFile()) {
        css = fs.readFileSync(cssPath, 'utf8')
    }
    const jsPath = metadata.script ? path.join(themePath, metadata.script) : null
    if (jsPath && fs.existsSync(jsPath) && fs.statSync(jsPath).isFile()) {
        js = fs.readFileSync(jsPath, 'utf8')
        js = sanitizeScript(js)
    }

    const themeData = {
        name: themeDef ? 'Default' : State.get('addons.theme') || 'Default',
        css: css || '{}',
        script: js || '',
    }

    io.sockets.sockets.forEach(sock => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            if (withJs) {
                sock.emit('THEME', {
                    theme: themeData,
                })
            } else {
                sock.emit('UPDATE_CSS', {
                    theme: { css: themeData.css, name: themeData.name },
                })
            }
            sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
        }
    })
}

export const sendExtensions = async (): Promise<void> => {
    if (!io) return

    let scripts = State.get('addons.scripts')
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
    } catch {
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
                    const cssFile = path.join(addonsFolder, folderName, meta.css)
                    if (fs.existsSync(cssFile)) {
                        css = fs.readFileSync(cssFile, 'utf8')
                    }
                }
                let script: string | null = null
                if (meta.script) {
                    const jsFile = path.join(addonsFolder, folderName, meta.script)
                    if (fs.existsSync(jsFile)) {
                        let content = fs.readFileSync(jsFile, 'utf8')
                        content = sanitizeScript(content)
                        script = content
                    }
                }

                return {
                    name: folderMatches ? folderName : addonName,
                    css,
                    script,
                }
            } catch {
                return null
            }
        })
        .filter((x): x is { name: string; css: string | null; script: string | null } => Boolean(x))

    io.sockets.sockets.forEach(sock => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            sock.emit(MainEvents.REFRESH_EXTENSIONS, {
                addons: found,
            })
            sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
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
            sock.emit(MainEvents.REFRESH_EXTENSIONS, { addons: [] })
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

ipcMain.on(MainEvents.WEBSOCKET_START, async () => {
    if (isAppDev && !State.get('settings.devSocket')) return
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

export const get_current_track = () => {
    io?.sockets.sockets.forEach(sock => {
        const s = sock as any
        if (s.clientType === 'yaMusic' && authorized && s.hasPong) {
            sock.emit(MainEvents.GET_TRACK_INFO)
        }
    })
}

ipcMain.on(MainEvents.GET_TRACK_INFO, () => {
    logger.http.log('GET_TRACK_INFO: returning current track...')
    get_current_track()
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

export const getTrackInfo = () => data
export default server

