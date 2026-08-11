import * as fs from 'original-fs'
import * as path from 'path'
import { createHash } from 'node:crypto'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { sanitizeScript } from '../../utils/addonUtils'
import { Server as IOServer, Socket } from 'socket.io'
import { readAddonSettings } from './addonSettings'
import { resolveAddonDirectory, resolveAddonDisplayName, resolveAddonId } from '../../utils/addonRegistry'
import { getAddonsRoot, resolveExistingFileInsideBase } from '../../utils/addonPaths'

interface StateLike {
    get: (key: string) => any
    set: (key: string, value: any) => void
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
    webHostAddonProtocolVersion?: number
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

type WebHostAddonPayload = {
    id: string
    name: string
    directoryName: string
    version?: string
    css: string
    code: string
}

type WebHostAddonsSnapshot = {
    hash: string
    addons: WebHostAddonPayload[]
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

const hashWebHostAddons = (addons: WebHostAddonPayload[]): string =>
    createHash('sha256')
        .update(
            JSON.stringify(
                [...addons].sort((left, right) => {
                    const leftKey = JSON.stringify(left)
                    const rightKey = JSON.stringify(right)
                    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
                }),
            ),
        )
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

    const readWebHostAddonPayloads = (): WebHostAddonPayload[] => {
        const scripts = getSelectedScriptDirectories()
        const addonsFolder = getAddonsRoot()
        let dirs: string[] = []
        try {
            dirs = fs.readdirSync(addonsFolder)
        } catch {
            return []
        }

        return dirs
            .map<WebHostAddonPayload | null>(folderName => {
                const metadataPath = path.join(addonsFolder, folderName, 'metadata.json')
                if (!fs.existsSync(metadataPath)) return null

                try {
                    const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
                    if (meta.type !== 'web-addon') return null

                    const metaName = typeof meta.name === 'string' ? meta.name.trim() : ''
                    const addonName = metaName || folderName
                    if (!scripts.includes(folderName) && !(metaName.length > 0 && scripts.includes(metaName))) return null

                    const id = typeof meta.id === 'string' && meta.id.trim() ? meta.id.trim() : folderName
                    const cssFile = meta.css ? path.join(addonsFolder, folderName, meta.css) : null
                    const scriptFile = meta.script ? path.join(addonsFolder, folderName, meta.script) : null
                    const css = cssFile && fs.existsSync(cssFile) && fs.statSync(cssFile).isFile() ? fs.readFileSync(cssFile, 'utf8') : ''
                    const code =
                        scriptFile && fs.existsSync(scriptFile) && fs.statSync(scriptFile).isFile()
                            ? sanitizeScript(fs.readFileSync(scriptFile, 'utf8'))
                            : ''

                    return {
                        id,
                        name: addonName,
                        directoryName: folderName,
                        version: typeof meta.version === 'string' ? meta.version : undefined,
                        css,
                        code,
                    }
                } catch {
                    return null
                }
            })
            .filter((addon): addon is WebHostAddonPayload => addon !== null)
    }

    const readWebHostAddonsSnapshot = (): WebHostAddonsSnapshot => {
        const addons = readWebHostAddonPayloads()
        return { hash: hashWebHostAddons(addons), addons }
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

    const emitWebHostAddonsSnapshot = (socket: Socket, snapshot: WebHostAddonsSnapshot): void => {
        socket.emit(MainEvents.WEBHOST_ADDONS_SNAPSHOT, snapshot)
    }

    const supportsWebHostAddons = (socket: Socket, protocolVersion?: number): boolean =>
        Number(protocolVersion ?? (socket as any).webHostAddonProtocolVersion) >= 1

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

    const sendExtensions = async (): Promise<number> => {
        const io = getIo()
        if (!io) return 0
        const found = readExtensionPayloads()
        const webHostSnapshot = readWebHostAddonsSnapshot()
        let recipients = 0

        io.sockets.sockets.forEach(sock => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                sock.emit(MainEvents.REFRESH_EXTENSIONS, { addons: found })
                if (supportsWebHostAddons(sock)) {
                    recipients += 1
                    emitWebHostAddonsSnapshot(sock, webHostSnapshot)
                }
                sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            }
        })

        return recipients
    }

    const reloadDevelopmentAddon = async (directoryName: string): Promise<{ enabled: true; recipients: number }> => {
        if (!directoryName || directoryName === '.' || directoryName === '..' || path.basename(directoryName) !== directoryName) {
            throw new Error('Development addon directory is invalid')
        }

        const addonDirectory = resolveAddonDirectory(directoryName)
        if (!addonDirectory || addonDirectory !== directoryName) throw new Error('Development addon directory was not found')

        const metadataPath = path.join(getAddonsRoot(), addonDirectory, 'metadata.json')
        if (!fs.existsSync(metadataPath)) throw new Error('Development addon metadata was not found')

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { installSource?: unknown; script?: unknown; type?: unknown }
        if (metadata.type !== 'web-addon') throw new Error('Development reload only supports web-addon packages')
        if (metadata.installSource === 'store') throw new Error('Development reload refuses store-managed addons')
        if (typeof metadata.script !== 'string' || !resolveExistingFileInsideBase(path.dirname(metadataPath), metadata.script)) {
            throw new Error('Development addon script is missing or invalid')
        }

        const storedScripts = readStoredAddonScripts()
        const alreadyEnabled = storedScripts.some(script => resolveAddonDirectory(script) === addonDirectory)
        if (!alreadyEnabled) {
            state.set('addons.scripts', [...storedScripts, addonDirectory])
        }

        return { enabled: true, recipients: await sendExtensions() }
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
        const addonId = resolveAddonId(addonDirectory) || addonDirectory
        const addonKeys = Array.from(new Set([addonDisplayName, addonId]))
        if (!force && addonKeys.every(addonKey => lastAddonSettings.get(addonKey) === serialized)) {
            return
        }

        addonKeys.forEach(addonKey => lastAddonSettings.set(addonKey, serialized))

        for (const sock of getMusicRecipients(targetSocket)) {
            addonKeys.forEach(addonKey => {
                sock.emit('ADDON_SETTINGS_UPDATE', {
                    addon: addonKey,
                    settings,
                })
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
                const addonId = resolveAddonId(addonDirectory) || addonDirectory
                const settings = readAddonSettings(addonDirectory)
                acc[addonDisplayName] = settings
                acc[addonId] = settings
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

    const sendDataToMusic = ({
        targetSocket,
        currentAddonStateHashVersion,
        currentAddonStateHash,
        webHostAddonProtocolVersion,
    }: DataToMusicOptions = {}) => {
        const io = getIo()
        if (!io) return
        const recipients = getMusicRecipients(targetSocket)
        if (!recipients.length) return

        const syncKey = targetSocket?.id || '__all__'
        const snapshot = readAddonStateSnapshot()
        const webHostSnapshot = readWebHostAddonsSnapshot()
        const desiredAddonStateHash = hashAddonState(snapshot)
        const stateMatches =
            currentAddonStateHashVersion === 1 &&
            typeof currentAddonStateHash === 'string' &&
            currentAddonStateHash.length > 0 &&
            currentAddonStateHash === desiredAddonStateHash

        for (const socket of recipients) {
            if (!stateMatches) emitAddonStateSnapshot(socket, snapshot)
            else socket.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            if (supportsWebHostAddons(socket, webHostAddonProtocolVersion)) emitWebHostAddonsSnapshot(socket, webHostSnapshot)
        }
        logger.http.log(
            stateMatches
                ? `Addon state unchanged for ${recipients.length} music client(s)`
                : `Current addon state sent to ${recipients.length} music client(s)`,
        )

        const existingTimer = pendingDataSyncTimers.get(syncKey)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            pendingDataSyncTimers.delete(syncKey)
            sendAllAddonSettings({ targetSocket, force: true })
        }, 1000)
        pendingDataSyncTimers.set(syncKey, timer)
    }

    const getCurrentTrack = () => {
        const io = getIo()
        if (!io) return 0

        let recipients = 0
        io.sockets.sockets.forEach(sock => {
            const socket = sock as any
            if (socket.clientType === 'yaMusic' && getAuthorized() && socket.hasPong) {
                sock.emit(MainEvents.GET_TRACK_INFO)
                recipients += 1
            }
        })
        return recipients
    }

    const sendPremiumUserToClients = (args: any) => {
        const io = getIo()
        if (!io) return

        io.sockets.sockets.forEach(client => {
            const socket = client as any
            if (socket.clientType === 'yaMusic' && getAuthorized() && socket.hasPong && socket.userValidationProtocolVersion !== 1) {
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
        reloadDevelopmentAddon,
        sendAddonSettings,
        sendAllAddonSettings,
        sendDataToMusic,
        getCurrentTrack,
        sendPremiumUserToClients,
    }
}
