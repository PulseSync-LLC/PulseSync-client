import * as fs from 'original-fs'
import * as path from 'path'
import { app } from 'electron'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { sanitizeScript } from '../../utils/addonUtils'
import { Server as IOServer, Socket } from 'socket.io'
import { mainWindow } from '../createWindow'

interface StateLike {
    get: (key: string) => any
}

interface LoggerLike {
    http: {
        log: (...args: any[]) => void
    }
}

interface CreateAddonServiceOptions {
    state: StateLike
    logger: LoggerLike
    getIo: () => IOServer | null
    getAuthorized: () => boolean
    getSelectedAddon: () => string
}

interface DataToMusicOptions {
    targetSocket?: Socket
}

export const createAddonService = ({ state, logger, getIo, getAuthorized, getSelectedAddon }: CreateAddonServiceOptions) => {
    const getAllAllowedUrls = (): string[] => {
        const addonsFolder = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const urls = new Set<string>()

        let folders: string[] = []
        try {
            folders = fs.readdirSync(addonsFolder)
        } catch {
            return []
        }

        const stateTheme = state.get('addons.theme')
        const selected = getSelectedAddon()
        const themeFolder =
            typeof stateTheme === 'string' && stateTheme.trim()
                ? stateTheme.trim()
                : typeof selected === 'string' && selected.trim()
                  ? selected.trim()
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

        let scripts = state.get('addons.scripts')
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

    const setAddon = (_theme: string) => {
        const io = getIo()
        if (!getAuthorized() || !io) return

        const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const selected = getSelectedAddon()
        const themePath = path.join(themesPath, selected)
        const metadataPath = path.join(themePath, 'metadata.json')
        if (!fs.existsSync(metadataPath)) return

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        const cssPath = path.join(themePath, metadata.css || '')
        const jsPath = metadata.script ? path.join(themePath, metadata.script) : null
        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
        let js = jsPath && fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''
        js = sanitizeScript(js)

        const themeData = { name: selected, css: css || '{}', script: js || '' }
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
            io.sockets.sockets.forEach(sock => {
                const s = sock as any
                if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                    sock.emit('THEME', {
                        theme: themeData,
                        allowedUrls: getAllAllowedUrls(),
                    })
                    sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
                }
            })
        })
    }

    const sendAddon = (withJs: boolean, themeDef?: boolean) => {
        const io = getIo()
        if (!io) return

        const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const themeFolder = themeDef ? 'Default' : state.get('addons.theme') || 'Default'
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
            name: themeDef ? 'Default' : state.get('addons.theme') || 'Default',
            css: css || '{}',
            script: js || '',
        }

        io.sockets.sockets.forEach(sock => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                if (withJs) {
                    sock.emit('THEME', { theme: themeData })
                } else {
                    sock.emit('UPDATE_CSS', {
                        theme: { css: themeData.css, name: themeData.name },
                    })
                }
                sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            }
        })
    }

    const sendExtensions = async (): Promise<void> => {
        const io = getIo()
        if (!io) return

        let scripts = state.get('addons.scripts')
        if (!scripts) return

        if (typeof scripts === 'string') {
            scripts = scripts
                .split(',')
                .map((s: string) => s.trim())
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
                        if (fs.existsSync(cssFile)) css = fs.readFileSync(cssFile, 'utf8')
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
            if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                sock.emit(MainEvents.REFRESH_EXTENSIONS, { addons: found })
                sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            }
        })
    }

    const sendDataToMusic = ({ targetSocket }: DataToMusicOptions = {}) => {
        const io = getIo()
        if (!io) return

        const sendOnce = (sock: Socket) => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                sendAddon(true, true)
                sock.emit(MainEvents.REFRESH_EXTENSIONS, { addons: [] })
                logger.http.log('Data sent after READY')
            }
        }

        if (targetSocket) sendOnce(targetSocket)
        else io.sockets.sockets.forEach(sendOnce)

        setTimeout(async () => {
            io.sockets.sockets.forEach(sock => {
                const s = sock as any
                if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                    sendAddon(true)
                }
            })
            await sendExtensions()
        }, 1000)
    }

    const getCurrentTrack = () => {
        const io = getIo()
        if (!io) return

        io.sockets.sockets.forEach(sock => {
            const socket = sock as any
            if (socket.clientType === 'yaMusic' && getAuthorized() && socket.hasPong) {
                sock.emit(MainEvents.GET_TRACK_INFO)
            }
        })
    }

    const sendPremiumUserToClients = (args: any) => {
        const io = getIo()
        if (!io) return

        io.sockets.sockets.forEach(client => {
            const socket = client as any
            if (socket.clientType === 'yaMusic' && getAuthorized() && socket.hasPong) {
                logger.http.log('Emitting PREMIUM_CHECK_TOKEN')
                client.emit(RendererEvents.PREMIUM_CHECK_TOKEN, {
                    ok: true,
                    token: args.token,
                    expiresAt: args.expiresAt,
                })
            }
        })
    }

    return {
        getAllAllowedUrls,
        setAddon,
        sendAddon,
        sendExtensions,
        sendDataToMusic,
        getCurrentTrack,
        sendPremiumUserToClients,
    }
}
