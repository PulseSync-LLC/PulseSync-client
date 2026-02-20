import * as http from 'http'
import * as fs from 'original-fs'
import * as path from 'path'
import { app } from 'electron'
import { parse } from 'url'
import { Track } from '../../../renderer/api/interfaces/track.interface'

interface LoggerLike {
    http: {
        log: (...args: any[]) => void
        error: (...args: any[]) => void
    }
    socketManager?: {
        error: (...args: any[]) => void
    }
}

interface CreateHttpRequestHandlerOptions {
    logger: LoggerLike
    allowedOrigins: string[]
    getAuthorized: () => boolean
    getTrackData: () => Track
}

const ASSET_PREFIX = '/assets/'

const sendJson = (res: http.ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
}

const setCorsHeaders = (req: http.IncomingMessage, res: http.ServerResponse, allowedOrigins: string[]) => {
    const origin = req.headers.origin as string | undefined
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
            const nested = findFileInDirectory(filename, fp)
            if (nested) return nested
            continue
        }
        if (path.basename(fp) === filename) {
            return fp
        }
    }
    return null
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

const getAddonRoot = () => path.join(app.getPath('appData'), 'PulseSync', 'addons')

const imageMimes: Record<string, string> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
}

export const createHttpRequestHandler = ({ logger, allowedOrigins, getAuthorized, getTrackData }: CreateHttpRequestHandlerOptions) => {
    const handleGetHandleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
            const { query } = parse(req.url || '', true)
            const name = query.name as string

            if (!name) return sendJson(res, 400, { error: 'Missing query parameters: name or type' })

            const handlePath = path.join(getAddonRoot(), name, 'handleEvents.json')
            if (!fs.existsSync(handlePath)) return sendJson(res, 404, { error: 'Handle events data not found' })

            const data = JSON.parse(fs.readFileSync(handlePath, 'utf8'))
            return sendJson(res, 200, { ok: true, data })
        } catch (err) {
            logger.http.error('Error processing get_handle:', err)
            sendJson(res, 500, { error: 'Internal server error' })
        }
    }

    const handleGetAssetsRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
            const { query } = parse(req.url || '', true)
            const name = query.name as string

            if (!name) return sendJson(res, 400, { error: 'Missing query parameter: name' })

            const addonPath = path.join(getAddonRoot(), name)
            const assetsDir = findAssetsDirectory(addonPath)
            if (!assetsDir) return sendJson(res, 404, { error: 'Assets folder not found' })

            return sendJson(res, 200, {
                ok: true,
                addonPath,
                assetsPath: assetsDir,
                files: getFilesInDirectory(assetsDir),
            })
        } catch (err) {
            logger.http.error('Error reading assets:', err)
            sendJson(res, 500, { error: 'Error reading assets' })
        }
    }

    const handleGetAssetFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
            const { pathname, query } = parse(req.url || '', true)
            const name = query.name as string
            if (!name) return sendJson(res, 400, { error: 'Missing query parameter: name' })

            const assetsDir = findAssetsDirectory(path.join(getAddonRoot(), name))
            if (!assetsDir) return sendJson(res, 404, { error: 'Assets folder not found' })

            const fileName = pathname!.substring(ASSET_PREFIX.length)
            const filePath = findFileInDirectory(fileName, assetsDir)
            logger.http.log('File Path:', filePath)

            if (!filePath) return sendJson(res, 404, { error: 'File not found' })

            const ext = path.extname(filePath).slice(1)
            res.writeHead(200, { 'Content-Type': imageMimes[ext] || 'application/octet-stream' })
            fs.createReadStream(filePath).pipe(res)
        } catch (err) {
            logger.http.error('Error serving asset file:', err)
            sendJson(res, 500, { error: 'Error serving asset file' })
        }
    }

    const handleGetAddonRootFileRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
            const { query } = parse(req.url || '', true)
            const name = query.name as string
            const fileName = query.file as string

            if (!name || !fileName) return sendJson(res, 400, { error: 'Missing query parameters: name or file' })
            if (/^https?:\/\//i.test(fileName)) {
                logger.http.log(`Skipping remote URL for root file: ${fileName}`)
                return sendJson(res, 400, { ok: false, error: 'Remote URLs are not served by this endpoint.' })
            }

            const targetPath = path.join(getAddonRoot(), name, fileName)
            if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
                return sendJson(res, 404, { error: 'File not found in addon root' })
            }

            const ext = path.extname(targetPath).slice(1)
            res.writeHead(200, {
                'Content-Type': imageMimes[ext] || 'application/octet-stream',
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                Pragma: 'no-cache',
                Expires: '0',
                'Surrogate-Control': 'no-store',
            })
            fs.createReadStream(targetPath).pipe(res)
        } catch (err) {
            if (logger.socketManager) {
                logger.socketManager.error('Error serving addon root file:', err)
            } else {
                logger.http.error('Error serving addon root file:', err)
            }
            sendJson(res, 500, { error: 'Error serving addon root file' })
        }
    }

    const handleGetTrack = (_req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
            if (!getAuthorized()) return sendJson(res, 403, { error: 'Unauthorized' })
            sendJson(res, 200, getTrackData())
        } catch (err) {
            logger.http.error('Error processing get_track:', err)
            sendJson(res, 500, { error: 'Internal server error' })
        }
    }

    const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {
        '/get_handle': handleGetHandleRequest,
        '/assets': handleGetAssetsRequest,
        '/addon_file': handleGetAddonRootFileRequest,
        '/get_track': handleGetTrack,
    }

    return (req: http.IncomingMessage, res: http.ServerResponse) => {
        const { method, url } = req
        const { pathname } = parse(url || '', true)

        setCorsHeaders(req, res, allowedOrigins)

        if (method === 'OPTIONS') {
            res.writeHead(204)
            return res.end()
        }
        if (pathname?.startsWith('/socket.io/')) {
            return
        }
        if (method === 'GET') {
            if (pathname && routes[pathname]) return routes[pathname](req, res)
            if (pathname && pathname.startsWith(ASSET_PREFIX)) return handleGetAssetFileRequest(req, res)
        }

        sendJson(res, 404, { error: 'Not found' })
    }
}
