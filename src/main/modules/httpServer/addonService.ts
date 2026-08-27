import { createHash } from 'node:crypto'

import * as fs from 'original-fs'
import * as path from 'path'

import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { getAddonsRoot, resolveExistingFileInsideBase } from '../../utils/addonPaths'
import { resolveAddonDirectory, resolveAddonDisplayName, resolveAddonId } from '../../utils/addonRegistry'
import { sanitizeLegacyScript } from '../../utils/legacyScriptSanitizer'
import { validateWebHostAddonRuntime } from '../../utils/webHostAddonRuntime'
import { readAddonSettings } from './addonSettings'

import type { Server as IOServer, Socket } from 'socket.io'

interface StateLike {
    get: (key: string) => any
    set: (key: string, value: any) => void
}

interface LoggerLike {
    http: {
        log: (...args: any[]) => void
        warn: (...args: any[]) => void
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

type WebHostAssetBase = {
    id: string
    name: string
    directoryName: string
    version?: string
    css: string
}

type WebHostAddonPayload = WebHostAssetBase & {
    type: 'web-addon'
    code: string
}

type WebHostThemePayload = WebHostAssetBase & {
    type: 'theme'
}

type WebHostAssetPayload = WebHostAddonPayload | WebHostThemePayload

type WebHostAddonsSnapshot = {
    hash: string
    addons: WebHostAssetPayload[]
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

const WEB_HOST_ADDON_PROTOCOL_VERSION = 1
const WEB_HOST_THEME_PROTOCOL_VERSION = 2

const hashWebHostAddons = (addons: WebHostAssetPayload[]): string =>
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
                scriptPath && fs.existsSync(scriptPath) && fs.statSync(scriptPath).isFile()
                    ? sanitizeLegacyScript(fs.readFileSync(scriptPath, 'utf8'))
                    : ''

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
                        if (fs.existsSync(scriptFile)) script = sanitizeLegacyScript(fs.readFileSync(scriptFile, 'utf8'))
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
                    const addonRoot = path.join(addonsFolder, folderName)
                    const cssFile = typeof meta.css === 'string' ? resolveExistingFileInsideBase(addonRoot, meta.css) : null
                    const scriptFile = typeof meta.script === 'string' ? resolveExistingFileInsideBase(addonRoot, meta.script) : null
                    const css = cssFile && fs.existsSync(cssFile) && fs.statSync(cssFile).isFile() ? fs.readFileSync(cssFile, 'utf8') : ''
                    const rawCode =
                        scriptFile && fs.existsSync(scriptFile) && fs.statSync(scriptFile).isFile() ? fs.readFileSync(scriptFile, 'utf8') : ''
                    const validation = validateWebHostAddonRuntime(rawCode)
                    if (!validation.ok) {
                        logger.http.warn(`[PulseSync Addons] Blocked isolated addon ${id}: ${validation.category}: ${validation.reason}`)
                        return null
                    }

                    return {
                        type: 'web-addon',
                        id,
                        name: addonName,
                        directoryName: folderName,
                        version: typeof meta.version === 'string' ? meta.version : undefined,
                        css,
                        code: validation.code,
                    }
                } catch (error) {
                    logger.http.warn(
                        `[PulseSync Addons] Failed to read isolated addon ${folderName}: ${error instanceof Error ? error.message : String(error)}`,
                    )
                    return null
                }
            })
            .filter((addon): addon is WebHostAddonPayload => addon !== null)
    }

    const readWebHostThemePayload = (): WebHostThemePayload | null => {
        const directoryName = getSelectedThemeDirectory()
        if (directoryName.toLowerCase() === 'default') return null

        const themeRoot = path.join(getAddonsRoot(), directoryName)
        const metadataPath = path.join(themeRoot, 'metadata.json')
        if (!fs.existsSync(metadataPath)) return null

        try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
            if (metadata.type !== 'theme') return null

            const cssFile = typeof metadata.css === 'string' ? resolveExistingFileInsideBase(themeRoot, metadata.css) : null
            if (!cssFile || !fs.existsSync(cssFile) || !fs.statSync(cssFile).isFile()) return null

            const css = fs.readFileSync(cssFile, 'utf8')
            if (!css.trim() || css.trim() === '{}') return null

            const declaredScript = typeof metadata.script === 'string' && metadata.script.trim() ? metadata.script : null
            const scriptFile = declaredScript ? resolveExistingFileInsideBase(themeRoot, declaredScript) : null
            if (declaredScript && (!scriptFile || !fs.existsSync(scriptFile) || !fs.statSync(scriptFile).isFile())) return null
            const script = scriptFile && fs.existsSync(scriptFile) && fs.statSync(scriptFile).isFile() ? fs.readFileSync(scriptFile, 'utf8') : ''
            if (script.trim()) return null

            const id = typeof metadata.id === 'string' && metadata.id.trim() ? metadata.id.trim() : directoryName
            const name = typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : directoryName
            return {
                type: 'theme',
                id,
                name,
                directoryName,
                version: typeof metadata.version === 'string' ? metadata.version : undefined,
                css,
            }
        } catch (error) {
            logger.http.warn(
                `[PulseSync Addons] Failed to read CSS-only theme ${directoryName}: ${error instanceof Error ? error.message : String(error)}`,
            )
            return null
        }
    }

    const readWebHostAddonsSnapshot = (protocolVersion: number): { snapshot: WebHostAddonsSnapshot; handlesTheme: boolean } => {
        const addons: WebHostAssetPayload[] = readWebHostAddonPayloads()
        let handlesTheme = false

        if (protocolVersion >= WEB_HOST_THEME_PROTOCOL_VERSION) {
            const selectedThemeDirectory = getSelectedThemeDirectory()
            const theme = readWebHostThemePayload()
            handlesTheme = selectedThemeDirectory.toLowerCase() === 'default' || theme !== null
            if (theme) addons.unshift(theme)
        }

        return {
            snapshot: { hash: hashWebHostAddons(addons), addons },
            handlesTheme,
        }
    }

    const readAddonStateSnapshot = (): AddonStateSnapshot => ({
        theme: readThemePayload() || readThemePayload(true),
        extensions: readExtensionPayloads(),
    })

    const emitAddonStateSnapshot = (socket: Socket, snapshot: AddonStateSnapshot, includeTheme = true): void => {
        const legacyTheme = includeTheme ? snapshot.theme : readThemePayload(true)
        if (legacyTheme) socket.emit('THEME', { theme: legacyTheme })
        socket.emit(MainEvents.REFRESH_EXTENSIONS, { addons: snapshot.extensions })
        socket.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
    }

    const emitWebHostAddonsSnapshot = (socket: Socket, snapshot: WebHostAddonsSnapshot): void => {
        socket.emit(MainEvents.WEBHOST_ADDONS_SNAPSHOT, snapshot)
    }

    const getWebHostAddonProtocolVersion = (socket: Socket, protocolVersion?: number): number =>
        Number(protocolVersion ?? (socket as any).webHostAddonProtocolVersion) || 0

    const supportsWebHostAddons = (socket: Socket, protocolVersion?: number): boolean =>
        getWebHostAddonProtocolVersion(socket, protocolVersion) >= WEB_HOST_ADDON_PROTOCOL_VERSION

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
        js = sanitizeLegacyScript(js)

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
                    const protocolVersion = getWebHostAddonProtocolVersion(sock)
                    const webHost = readWebHostAddonsSnapshot(protocolVersion)
                    if (webHost.handlesTheme) {
                        const defaultTheme = readThemePayload(true)
                        if (defaultTheme) sock.emit('THEME', { theme: defaultTheme })
                        emitWebHostAddonsSnapshot(sock, webHost.snapshot)
                    } else {
                        sock.emit('THEME', { theme: themeData, allowedUrls: getAllAllowedUrls() })
                        if (protocolVersion >= WEB_HOST_THEME_PROTOCOL_VERSION) emitWebHostAddonsSnapshot(sock, webHost.snapshot)
                    }
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
                const protocolVersion = getWebHostAddonProtocolVersion(sock)
                const webHost = readWebHostAddonsSnapshot(protocolVersion)
                if (!themeDef && webHost.handlesTheme) {
                    const defaultTheme = readThemePayload(true)
                    if (defaultTheme) sock.emit('THEME', { theme: defaultTheme })
                    emitWebHostAddonsSnapshot(sock, webHost.snapshot)
                } else if (withJs) {
                    sock.emit('THEME', { theme: themeData })
                } else {
                    sock.emit('UPDATE_CSS', {
                        theme: { css: themeData.css, name: themeData.name },
                    })
                }
                if (!webHost.handlesTheme && protocolVersion >= WEB_HOST_THEME_PROTOCOL_VERSION) {
                    emitWebHostAddonsSnapshot(sock, webHost.snapshot)
                }
                sock.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            }
        })
    }

    const sendExtensions = async (): Promise<number> => {
        const io = getIo()
        if (!io) return 0
        const found = readExtensionPayloads()
        let recipients = 0

        io.sockets.sockets.forEach(sock => {
            const s = sock as any
            if (s.clientType === 'yaMusic' && getAuthorized() && s.hasPong) {
                sock.emit(MainEvents.REFRESH_EXTENSIONS, { addons: found })
                if (supportsWebHostAddons(sock)) {
                    recipients += 1
                    emitWebHostAddonsSnapshot(sock, readWebHostAddonsSnapshot(getWebHostAddonProtocolVersion(sock)).snapshot)
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

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
            id?: unknown
            installSource?: unknown
            script?: unknown
            type?: unknown
        }
        if (metadata.type !== 'web-addon') throw new Error('Development reload only supports web-addon packages')
        if (metadata.installSource === 'store') throw new Error('Development reload refuses store-managed addons')
        const scriptPath = typeof metadata.script === 'string' ? resolveExistingFileInsideBase(path.dirname(metadataPath), metadata.script) : null
        if (!scriptPath) {
            throw new Error('Development addon script is missing or invalid')
        }
        const addonId = typeof metadata.id === 'string' && metadata.id.trim() ? metadata.id.trim() : addonDirectory
        const validation = validateWebHostAddonRuntime(fs.readFileSync(scriptPath, 'utf8'))
        if (!validation.ok) {
            throw new Error(`Blocked isolated addon ${addonId}: ${validation.category}: ${validation.reason}`)
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
        const desiredAddonStateHash = hashAddonState(snapshot)
        const stateMatches =
            currentAddonStateHashVersion === 1 &&
            typeof currentAddonStateHash === 'string' &&
            currentAddonStateHash.length > 0 &&
            currentAddonStateHash === desiredAddonStateHash

        for (const socket of recipients) {
            const protocolVersion = getWebHostAddonProtocolVersion(socket, webHostAddonProtocolVersion)
            const webHost = readWebHostAddonsSnapshot(protocolVersion)
            if (!stateMatches) emitAddonStateSnapshot(socket, snapshot, !webHost.handlesTheme)
            else socket.emit('ALLOWED_URLS', { allowedUrls: getAllAllowedUrls() })
            if (supportsWebHostAddons(socket, protocolVersion)) emitWebHostAddonsSnapshot(socket, webHost.snapshot)
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
