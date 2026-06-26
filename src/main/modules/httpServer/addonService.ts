import * as fs from 'original-fs'
import * as path from 'path'
import { createHash } from 'node:crypto'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { sanitizeScript } from '../../utils/addonUtils'
import { Server as IOServer, Socket } from 'socket.io'
import { readAddonSettings } from './addonSettings'
import { resolveAddonDirectory, resolveAddonDisplayName } from '../../utils/addonRegistry'
import { getAddonsRoot } from '../../utils/addonPaths'

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
    currentAddonStateHashVersion?: number
    currentAddonStateHash?: string
}

type ThemePayload = {
    name: string
    css: string
    script: string
}

type RefreshedAddonPayload = {
    addon: string
    name: string
    directoryName: string
    id?: string
    css: string | null
    script: string | null
}

type AddonStateSnapshot = {
    theme: ThemePayload | null
    extensions: RefreshedAddonPayload[]
}

const canonicalizeAddonState = ({ theme, extensions }: AddonStateSnapshot) => ({
    theme:
        !theme || theme.name.toLowerCase() === 'default'
            ? { name: 'default', css: '', script: '' }
            : {
                  name: theme.name,
                  css: theme.css,
                  script: theme.script,
              },
    extensions: extensions
        .map(extension => ({
            addon: String(extension.addon || ''),
            name: String(extension.name || ''),
            directoryName: String(extension.directoryName || ''),
            id: String(extension.id || ''),
            css: typeof extension.css === 'string' ? extension.css : '',
            script: typeof extension.script === 'string' ? extension.script : '',
        }))
        .sort((left, right) => {
            const leftKey = JSON.stringify(left)
            const rightKey = JSON.stringify(right)
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
        }),
})

const hashAddonState = (snapshot: AddonStateSnapshot): string =>
    createHash('sha256')
        .update(JSON.stringify(canonicalizeAddonState(snapshot)))
        .digest('hex')

export const createAddonService = ({ state, logger, getIo, getAuthorized, getSelectedAddon }: CreateAddonServiceOptions) => {
    const lastAddonSettings = new Map<string, string>()
    const pendingDataSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()

    const readStoredAddonScripts = (): string[] => {
        const scripts = state.get('addons.scripts')
        if (typeof scripts === 'string') {
            return scripts
                .split(',')
                .map((script: string) => script.trim())
                .filter(Boolean)
        }

        return Array.isArray(scripts) ? scripts.map(script => String(script || '').trim()).filter(Boolean) : []
    }

    const getSelectedThemeDirectory = (): string => {
        const stateTheme = state.get('addons.theme')
        const selectedTheme =
            typeof stateTheme === 'string' && stateTheme.trim()
                ? stateTheme.trim()
                : typeof getSelectedAddon() === 'string' && getSelectedAddon().trim()
                  ? getSelectedAddon().trim()
                  : 'Default'

        return resolveAddonDirectory(selectedTheme) || 'Default'
    }

    const getSelectedScriptDirectories = (): string[] =>
        Array.from(
            new Set(
                readStoredAddonScripts()
                    .map(script => resolveAddonDirectory(script))
                    .filter(Boolean),
            ),
        )

    const getMusicRecipients = (targetSocket?: Socket): Socket[] => {
        const io = getIo()
        if (!io) return []

        const sockets = targetSocket ? [targetSocket] : Array.from(io.sockets.sockets.values())
        return sockets.filter(sock => {
            const client = sock as any
            return client.clientType === 'yaMusic' && getAuthorized() && client.hasPong
        })
    }

    const getAllAllowedUrls = (): string[] => {
        const addonsFolder = getAddonsRoot()
        const urls = new Set<string>()

        let folders: string[] = []
        try {
            folders = fs.readdirSync(addonsFolder)
        } catch {
            return []
        }

        const themeFolder = getSelectedThemeDirectory()

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

        const scripts = getSelectedScriptDirectories()

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

    const getEnabledAddonNames = (): string[] => {
        const enabled = new Set<string>()

        enabled.add(getSelectedThemeDirectory())
        getSelectedScriptDirectories().forEach(scriptName => enabled.add(scriptName))

        return Array.from(enabled)
    }

    const readThemePayload = (useDefault = false): ThemePayload | null => {
        const themesPath = getAddonsRoot()
        const themeFolder = useDefault ? 'Default' : getSelectedThemeDirectory()
        const themePath = path.join(themesPath, themeFolder)
        const metadataPath = path.join(themePath, 'metadata.json')
        if (!fs.existsSync(metadataPath)) return null

        try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
            if ((!metadata.type || (metadata.type !== 'theme' && metadata.type !== 'script')) && metadata.name !== 'Default') {
                return null
            }

            const cssPath = path.join(themePath, metadata.css || '')
            const scriptPath = metadata.script ? path.join(themePath, metadata.script) : null
            const css = metadata.css && fs.existsSync(cssPath) && fs.statSync(cssPath).isFile() ? fs.readFileSync(cssPath, 'utf8') : ''
            const script =
                scriptPath && fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile() ? sanitizeScript(fs.readFileSync(scriptPath, 'utf8')) : ''

            return {
                name: useDefault ? 'Default' : metadata.name || themeFolder,
                css: css || '{}',
                script,
            }
        } catch {
            return null
        }
    }

    const readExtensionPayloads = (): RefreshedAddonPayload[] => {
        const scripts = getSelectedScriptDirectories()

        const addonsFolder = getAddonsRoot()
        let dirs: string[] = []
        try {
            dirs = fs.readdirSync(addonsFolder)
        } catch {
            return []
        }

        return dirs
            .map<RefreshedAddonPayload | null>(folderName => {
                const metadataPath = path.join(addonsFolder, folderName, 'metadata.json')
                if (!fs.existsSync(metadataPath)) return null

                try {
                    const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
                    const metaName = typeof meta.name === 'string' ? meta.name.trim() : ''
                    const addonName = metaName || folderName
                    if (!scripts.includes(folderName) && !(metaName.length > 0 && scripts.includes(metaName))) return null
                    if ((!meta.type || (meta.type !== 'theme' && meta.type !== 'script')) && folderName !== 'Default') return null

                    let css: string | null = null
                    if (meta.css) {
                        const cssFile = path.join(addonsFolder, folderName, meta.css)
                        if (fs.existsSync(cssFile)) css = fs.readFileSync(cssFile, 'utf8')
                    }

                    let script: string | null = null
                    if (meta.script) {
                        const scriptFile = path.join(addonsFolder, folderName, meta.script)
                        if (fs.existsSync(scriptFile)) script = sanitizeScript(fs.readFileSync(scriptFile, 'utf8'))
                    }

                    return {
                        addon: folderName,
                        name: addonName,
                        directoryName: folderName,
                        id: typeof meta.id === 'string' ? meta.id : undefined,
                        css,
                        script,
                    }
                } catch {
                    return null
                }
            })
            .filter((addon): addon is RefreshedAddonPayload => addon !== null)
    }

    const readAddonStateSnapshot = (): AddonStateSnapshot => ({
        theme: readThemePayload() || readThemePayload(true),
        extensions: readExtensionPayloads(),
    })

    const emitAddonStateSnapshot = (socket: Socket, snapshot: AddonStateSnapshot): void => {
        if (snapshot.theme) socket.emit('THEME', { theme: snapshot.theme })
        socket.emit(MainEvents.REFRESH_EXTENSIONS, { addons: snapshot.extensions })
        socket.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
    }

    const setAddon = (_theme: string) => {
        const io = getIo()
        if (!getAuthorized() || !io) return

        const themesPath = getAddonsRoot()
        const selected = getSelectedThemeDirectory()
        const themePath = path.join(themesPath, selected)
        const metadataPath = path.join(themePath, 'metadata.json')
        if (!fs.existsSync(metadataPath)) return

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        const cssPath = path.join(themePath, metadata.css || '')
        const jsPath = metadata.script ? path.join(themePath, metadata.script) : null
        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : ''
        let js = jsPath && fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : ''
        js = sanitizeScript(js)

        const themeData = { name: metadata.name || selected, css: css || '{}', script: js || '' }
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
        const themeData = readThemePayload(Boolean(themeDef))
        if (!themeData) return

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
        const found = readExtensionPayloads()

        io.sockets.sockets.forEach(sock => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                sock.emit(MainEvents.REFRESH_EXTENSIONS, { addons: found })
                sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            }
        })
    }

    const sendAddonSettings = ({ addonName, targetSocket, force = false }: { addonName: string; targetSocket?: Socket; force?: boolean }): void => {
        if (!addonName) return
        const addonDirectory = resolveAddonDirectory(addonName)
        if (!addonDirectory) return
        if (!getEnabledAddonNames().includes(addonDirectory)) {
            return
        }

        const settings = readAddonSettings(addonDirectory)
        const serialized = JSON.stringify(settings)
        const addonDisplayName = resolveAddonDisplayName(addonDirectory) || addonDirectory
        if (!force && lastAddonSettings.get(addonDisplayName) === serialized) {
            return
        }

        lastAddonSettings.set(addonDisplayName, serialized)

        for (const sock of getMusicRecipients(targetSocket)) {
            sock.emit('ADDON_SETTINGS_UPDATE', {
                addon: addonDisplayName,
                settings,
            })
        }
    }

    const sendAllAddonSettings = ({
        targetSocket,
        force = false,
    }: {
        targetSocket?: Socket
        force?: boolean
    } = {}): void => {
        const snapshot = getEnabledAddonNames().reduce(
            (acc, addonName) => {
                const addonDirectory = resolveAddonDirectory(addonName)
                if (!addonDirectory) return acc
                const addonDisplayName = resolveAddonDisplayName(addonDirectory) || addonDirectory
                acc[addonDisplayName] = readAddonSettings(addonDirectory)
                return acc
            },
            {} as Record<string, ReturnType<typeof readAddonSettings>>,
        )
        if (force) {
            lastAddonSettings.clear()
        }
        Object.entries(snapshot).forEach(([addonName, settings]) => {
            lastAddonSettings.set(addonName, JSON.stringify(settings))
        })

        for (const sock of getMusicRecipients(targetSocket)) {
            sock.emit('ADDON_SETTINGS_SNAPSHOT', {
                settings: snapshot,
            })
        }
    }

    const sendDataToMusic = ({ targetSocket, currentAddonStateHashVersion, currentAddonStateHash }: DataToMusicOptions = {}) => {
        const io = getIo()
        if (!io) return
        const syncKey = targetSocket?.id || '__all__'
        const snapshot = readAddonStateSnapshot()
        const desiredAddonStateHash = hashAddonState(snapshot)
        const stateMatches =
            currentAddonStateHashVersion === 1 &&
            typeof currentAddonStateHash === 'string' &&
            currentAddonStateHash.length > 0 &&
            currentAddonStateHash === desiredAddonStateHash

        for (const socket of getMusicRecipients(targetSocket)) {
            if (!stateMatches) emitAddonStateSnapshot(socket, snapshot)
            else socket.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
        }
        logger.http.log(stateMatches ? 'Addon state unchanged after READY' : 'Current addon state sent after READY')

        const existingTimer = pendingDataSyncTimers.get(syncKey)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(async () => {
            pendingDataSyncTimers.delete(syncKey)
            if (!stateMatches) {
                for (const socket of getMusicRecipients(targetSocket)) {
                    emitAddonStateSnapshot(socket, snapshot)
                }
            }
            sendAllAddonSettings({ targetSocket, force: true })
        }, 1000)
        pendingDataSyncTimers.set(syncKey, timer)
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
        sendAddonSettings,
        sendAllAddonSettings,
        sendDataToMusic,
        getCurrentTrack,
        sendPremiumUserToClients,
    }
}
