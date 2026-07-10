import { app, BrowserWindow, dialog, ipcMain, type BrowserWindow as BrowserWindowType } from 'electron'
import process from 'process'
import path from 'path'
import * as fs from 'original-fs'
import createTray from './main/modules/tray'
import {
    consumePendingBrowserAuthFromDeepLink,
    consumePendingInstallModUpdateFromPath,
    createApplicationLaunchRequestHandler,
    setIsFirstInstance,
} from './main/modules/singleInstance'
import { sendAddonSettings, sendAllAddonSettings, sendExtensions, setAddon } from './main/modules/httpServer'
import { checkAsar, findAppByName, getPathToYandexMusic, isLinux, isMac, isWindows } from './main/utils/appUtils'
import logger from './main/modules/logger'
import isAppDev from './main/utils/isAppDev'
import { modManager } from './main/modules/mod/modManager'
import { HandleErrorsElectron } from './main/modules/handlers/handleErrorsElectron'

import { checkCLIArguments } from './main/utils/processUtils'
import { createDefaultAddonIfNotExists, loadAddons } from './main/utils/addonUtils'
import { migrateLegacyAddonSettings } from './main/utils/addonSettingsMigration'
import { createWindow, mainWindow } from './main/modules/createWindow'
import { handleEvents } from './main/events'
import { initMainI18n, t } from './main/i18n'
import Addon from '@entities/addon/model/addon.interface'
import { getState } from './main/modules/state'
import { startThemeWatcher } from './main/modules/nativeModules'
import * as fsp from 'fs/promises'
import MainEvents from './common/types/mainEvents'
import RendererEvents from './common/types/rendererEvents'
import { HANDLE_EVENTS_FILENAME, HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import { installModUpdateFromAsar } from './main/modules/mod/installModUpdateFrom'
import { processBrowserAuth } from './main/modules/auth/browserAuth'
import { runWhenUiReady } from './main/modules/uiReady'
import { sendAppStartupTelemetry } from './main/modules/telemetry/appTelemetry'
import { enableSystemProxySupport } from './main/modules/network/systemProxy'
import { getAddonsRoot, resolveExistingDirectoryInsideBase, resolveExistingPathInsideBase, resolvePathInsideBase } from './main/utils/addonPaths'
import {
    asarFilename,
    musicPath,
    selectedAddon,
    setMusicPath,
    setSelectedAddon,
    setUpdated,
} from './main/startup/runtimeState'
import { readBufResilient } from './main/utils/readBufResilient'
import { prestartCheck } from './main/startup/prestartCheck'
import type { LaunchRequestEnvelopeV1 } from './main/modules/bootstrapper/contracts'
import { configureUpdaterBootstrapRuntime, type UpdaterBootstrapRuntime } from './main/modules/updater/updater'

const State = getState()
initMainI18n(State.get('settings.language'))

if (isWindows()) {
    app.setAppUserModelId('pulsesync.app')
}

const mimeByExt: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
}

const registerPulseSyncProtocol = (): void => {
    try {
        const entryFile = process.argv[1]
        const isDevProtocolRegistration = Boolean(process.defaultApp || (isAppDev && entryFile))
        isDevProtocolRegistration
            ? app.setAsDefaultProtocolClient('pulsesync', process.execPath, entryFile ? [path.resolve(entryFile)] : [])
            : app.setAsDefaultProtocolClient('pulsesync')
    } catch (error) {
        logger.main.warn('Failed to register pulsesync:// protocol handler:', error)
    }
}

registerPulseSyncProtocol()

const checkOldYandexMusic = async () => {
    try {
        const namePart = 'Yandex.Music'
        const pkg = await findAppByName(namePart)

        if (pkg && mainWindow && !mainWindow.isDestroyed()) {
            logger.main.info('Old Yandex Music found, sending dialog event to renderer')
            mainWindow.webContents.send(RendererEvents.SHOW_YANDEX_MUSIC_UPDATE_DIALOG)
        }
    } catch (err) {
        logger.main.warn('Unable to check old Yandex Music AppX package:', err)
    }
}

const initializeMusicPath = async () => {
    try {
        setMusicPath(await getPathToYandexMusic())
    } catch (err) {
        logger.main.error(t('main.index.musicPathError'), err)
    }
}
export type ApplicationStartupContext = {
    bootstrapRuntime?: UpdaterBootstrapRuntime
    bootstrapWindow?: BrowserWindowType
}

export type ApplicationStartupHandle = {
    deliverLaunchRequest(request: LaunchRequestEnvelopeV1): Promise<boolean>
    ready: Promise<void>
}

let applicationStarted = false

export async function startMainApplication(context: ApplicationStartupContext = {}): Promise<ApplicationStartupHandle> {
    if (applicationStarted) {
        throw new Error('Application main has already started')
    }
    applicationStarted = true
    setIsFirstInstance(true)
    if (context.bootstrapRuntime) {
        configureUpdaterBootstrapRuntime(context.bootstrapRuntime)
    }

    try {
        await enableSystemProxySupport()
        HandleErrorsElectron.processStoredCrashes()
        await initializeMusicPath()

        setUpdated(checkCLIArguments(isAppDev))
        await prestartCheck()
        if (isAppDev && (isWindows() || isMac())) {
            const openAtLogin = app.getLoginItemSettings().openAtLogin
            if (openAtLogin) {
                app.setLoginItemSettings({
                    openAtLogin: false,
                    path: app.getPath('exe'),
                })
            }
        }
        const windowStartup = await createWindow({ bootstrapWindow: context.bootstrapWindow })
        handleEvents(mainWindow)
        const handleLaunchRequest = await createApplicationLaunchRequestHandler()
        const completedIds = new Set<string>(
            Array.isArray(State.get('app.completedLaunchRequestIds'))
                ? State.get('app.completedLaunchRequestIds').filter((value: unknown): value is string => typeof value === 'string').slice(-256)
                : [],
        )
        const deliverLaunchRequest = async (request: LaunchRequestEnvelopeV1): Promise<boolean> => {
            if (completedIds.has(request.id)) return true
            await windowStartup.ready
            await handleLaunchRequest(request)
            completedIds.add(request.id)
            State.set('app.completedLaunchRequestIds', Array.from(completedIds).slice(-256))
            return true
        }
        const pendingBrowserAuth = consumePendingBrowserAuthFromDeepLink()
        if (pendingBrowserAuth) {
            void processBrowserAuth(pendingBrowserAuth, { window: mainWindow }).catch(err => {
                logger.main.error('Failed to process pending BROWSER_AUTH deeplink:', err)
            })
        }
        const pendingInstallModUpdateFrom = consumePendingInstallModUpdateFromPath()
        if (pendingInstallModUpdateFrom) {
            runWhenUiReady(() => {
                void installModUpdateFromAsar(pendingInstallModUpdateFrom.path, mainWindow, pendingInstallModUpdateFrom.source).catch(err => {
                    logger.main.error('Failed to apply pending INSTALL_MOD_UPDATE_FROM:', err)
                })
            })
        }
        if (isWindows()) {
            await checkOldYandexMusic()
        }
        modManager(mainWindow)
        createTray()
        void sendAppStartupTelemetry()
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') app.quit()
        })
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) void createWindow()
        })
        return { ready: windowStartup.ready, deliverLaunchRequest }
    } catch (e) {
        HandleErrorsElectron.handleError('prestartCheck', 'checkYandexMusicApp', 'app_startup', e)
        logger.main.error(t('main.index.appStartupError'), e)
        applicationStarted = false
        throw e
    }
}

const ensureDir = async (p: string) => fsp.mkdir(path.dirname(p), { recursive: true })
const safeJson = (obj: any) => {
    try {
        return JSON.stringify(obj, null, 4)
    } catch {
        return String(obj ?? '')
    }
}

function sanitizeAddonFilename(name: string) {
    return String(name || 'addon')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .trim()
}

const resolveAddonFilePath = (targetPath: string, options: { mustExist?: boolean } = {}): string | null => {
    const addonsRoot = getAddonsRoot()
    const resolvedPath = options.mustExist
        ? resolveExistingPathInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))
        : resolvePathInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))

    return resolvedPath
}

const resolveWritableAddonFilePath = (targetPath: string): string | null => {
    const addonsRoot = getAddonsRoot()
    const resolvedPath = resolvePathInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))
    if (!resolvedPath) return null

    if (fs.existsSync(resolvedPath)) {
        return resolveExistingPathInsideBase(addonsRoot, resolvedPath)
    }

    let existingParent = path.dirname(resolvedPath)
    while (existingParent && !fs.existsSync(existingParent)) {
        const nextParent = path.dirname(existingParent)
        if (nextParent === existingParent) break
        existingParent = nextParent
    }

    return resolveExistingDirectoryInsideBase(addonsRoot, existingParent) ? resolvedPath : null
}

const resolveAddonDirectoryPath = (targetPath: string): string | null => {
    const addonsRoot = getAddonsRoot()
    return resolveExistingDirectoryInsideBase(addonsRoot, resolveInputPath(String(targetPath || '')))
}

const toAddonRelativePath = (addonDirectoryPath: string, filePath: string): string | null => {
    const relativePath = path.relative(addonDirectoryPath, filePath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null
    }

    return relativePath.replace(/\\/g, '/')
}
const getInputPathCandidates = (p0: string): string[] => {
    if (!p0) return []
    const list: string[] = []
    if (p0.startsWith('file://')) {
        try {
            const u = new URL(p0)
            list.push(path.normalize(decodeURI(u.pathname)))
        } catch {}
    } else {
        list.push(path.normalize(p0))
    }
    const norm = list[0] || ''
    const variants = new Set<string>()
    if (norm) {
        variants.add(norm)
        if (process.platform === 'win32') {
            variants.add(norm.replace(/\//g, '\\'))
            variants.add(norm.replace(/\\/g, '/'))
            if (!norm.startsWith('\\\\?\\')) variants.add('\\\\?\\' + norm)
        }
        try {
            variants.add(norm.normalize('NFC'))
        } catch {}
        try {
            variants.add(norm.normalize('NFD'))
        } catch {}
        variants.add(norm.replace(/^["']|["']$/g, ''))
    }
    return Array.from(variants)
}

const resolveInputPath = (p0: string): string => {
    const variants = getInputPathCandidates(p0)
    for (const candidate of variants) {
        if (fs.existsSync(candidate)) return candidate
    }
    return variants[0] || ''
}
const mimeFromExt = (p: string) => {
    const ext = path.extname(p).toLowerCase()
    return (mimeByExt as any)?.[ext] || 'application/octet-stream'
}

const handleSettingsFilenames = new Set([HANDLE_EVENTS_FILENAME.toLowerCase(), HANDLE_EVENTS_SETTINGS_FILENAME.toLowerCase()])

const readStoredAddonScripts = (): string[] => {
    const scripts = State.get('addons.scripts')

    if (typeof scripts === 'string') {
        return scripts
            .split(',')
            .map(script => script.trim())
            .filter(Boolean)
    }

    return Array.isArray(scripts) ? scripts.map(script => String(script || '').trim()).filter(Boolean) : []
}

const syncAddonClients = async (): Promise<void> => {
    setSelectedAddon(State.get('addons.theme') || 'Default')
    setAddon(selectedAddon)
    await sendExtensions()
    sendAllAddonSettings({ force: true })
}

const emitAddonSettingsWriteIfNeeded = (writtenPath: string): void => {
    if (!writtenPath) return

    const normalizedPath = path.normalize(writtenPath)
    if (!handleSettingsFilenames.has(path.basename(normalizedPath).toLowerCase())) {
        return
    }

    const addonsRoot = getAddonsRoot()
    const relativePath = path.relative(addonsRoot, normalizedPath)
    const isOutsideAddonsRoot = relativePath.startsWith('..') || path.isAbsolute(relativePath)
    if (isOutsideAddonsRoot) {
        return
    }

    const parts = relativePath.split(path.sep).filter(Boolean)
    const addonName = parts[0]
    if (!addonName) {
        sendAllAddonSettings({ force: true })
        return
    }

    sendAddonSettings({ addonName, force: true })
}

ipcMain.handle(MainEvents.FILE_EVENT, async (_event, eventType, filePath, data) => {
    try {
        switch (eventType) {
            case RendererEvents.CHECK_FILE_EXISTS: {
                if (!filePath) return false
                const candidates = getInputPathCandidates(filePath)
                for (const candidate of candidates) {
                    try {
                        if (fs.existsSync(candidate)) return true
                        await fsp.access(candidate, fs.constants.F_OK)
                        return true
                    } catch {}
                }
                return false
            }

            case RendererEvents.READ_FILE: {
                if (!filePath) return null
                try {
                    const p = resolveInputPath(filePath)
                    const enc = (data?.encoding as BufferEncoding) || 'utf8'
                    return await fsp.readFile(p, enc)
                } catch (error: any) {
                    if (error?.code === 'ENOENT') {
                        return null
                    }
                    logger?.main?.error?.('[file-event:read-file]', error)
                    return null
                }
            }

            case RendererEvents.WRITE_FILE: {
                if (!filePath) return { success: false, error: 'filePath is required' }
                try {
                    const p = resolveInputPath(filePath)
                    const enc = (data?.encoding as BufferEncoding) || 'utf8'
                    const content = typeof data === 'string' ? data : typeof data?.content === 'string' ? data.content : safeJson(data)
                    await ensureDir(p)
                    await fsp.writeFile(p, content, enc)
                    emitAddonSettingsWriteIfNeeded(p)
                    return { success: true }
                } catch (error: any) {
                    logger?.main?.error?.('[file-event:write-file]', error)
                    return { success: false, error: error?.message || String(error) }
                }
            }

            case RendererEvents.READ_FILE_BASE64: {
                if (!filePath) return null
                try {
                    const p = resolveInputPath(filePath)
                    const buf = await readBufResilient(p)
                    return buf.toString('base64')
                } catch (error: any) {
                    if (error?.code === 'ENOENT') {
                        return null
                    }
                    logger?.main?.error?.('[file-event:read-file-base64]', error)
                    return null
                }
            }

            case RendererEvents.WRITE_FILE_BASE64: {
                if (!filePath) return false
                try {
                    const p = resolveInputPath(filePath)
                    const base64: string = typeof data === 'string' ? data : data?.base64
                    if (!base64) return false
                    await ensureDir(p)
                    const buf = Buffer.from(base64, 'base64')
                    await fsp.writeFile(p, buf)
                    return true
                } catch (error) {
                    logger?.main?.error?.('[file-event:write-file-base64]', error)
                    return false
                }
            }

            case RendererEvents.DELETE_FILE: {
                if (!filePath) return false
                try {
                    const p = resolveInputPath(filePath)
                    await fsp.rm(p, { force: true, recursive: false })
                } catch {}
                return true
            }

            case RendererEvents.COPY_FILE: {
                const src: string = filePath
                const dest: string = data?.dest
                if (!src || !dest) return false
                const s = resolveInputPath(src)
                const d = resolveInputPath(dest)
                await ensureDir(d)
                try {
                    const buf = await readBufResilient(s)
                    await fsp.writeFile(d, buf)
                } catch {
                    await fsp.copyFile(s, d)
                }
                return true
            }

            case RendererEvents.AS_DATA_URL: {
                if (!filePath) return null
                try {
                    const p = resolveInputPath(filePath)
                    const buf = await readBufResilient(p)
                    const mime = mimeFromExt(p)
                    return `data:${mime};base64,${buf.toString('base64')}`
                } catch (e) {
                    logger?.main?.error?.('[file-event:as-data-url]', e)
                    return null
                }
            }

            case RendererEvents.CREATE_CONFIG_FILE: {
                if (!filePath) return { success: false, error: 'filePath is required' }
                try {
                    const p = resolveInputPath(filePath)
                    await ensureDir(p)
                    await fsp.writeFile(p, safeJson(data), 'utf8')
                    emitAddonSettingsWriteIfNeeded(p)
                    return { success: true }
                } catch (error: any) {
                    logger?.main?.error?.('[file-event:create-config-file]', error)
                    return { success: false, error: error?.message || String(error) }
                }
            }

            default:
                logger?.main?.error?.('[file-event] Unknown eventType:', eventType)
                return { success: false, error: 'Unknown eventType' }
        }
    } catch (err: any) {
        logger?.main?.error?.('[file-event] Fatal:', eventType, err)
        switch (eventType) {
            case RendererEvents.CHECK_FILE_EXISTS:
                return false
            case RendererEvents.READ_FILE:
            case RendererEvents.READ_FILE_BASE64:
            case RendererEvents.AS_DATA_URL:
                return null
            default:
                return { success: false, error: err?.message || String(err) }
        }
    }
})

ipcMain.handle(MainEvents.ADDON_FILE_EXISTS, async (_event, targetPath: string) => {
    return Boolean(resolveAddonFilePath(targetPath, { mustExist: true }))
})

ipcMain.handle(MainEvents.ADDON_FILE_READ_TEXT, async (_event, targetPath: string, encoding?: BufferEncoding) => {
    const filePath = resolveAddonFilePath(targetPath, { mustExist: true })
    if (!filePath) return null

    try {
        return await fsp.readFile(filePath, encoding || 'utf8')
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger?.main?.error?.('[addon-file:read-text]', error)
        }
        return null
    }
})

ipcMain.handle(MainEvents.ADDON_FILE_WRITE_TEXT, async (_event, targetPath: string, content: string) => {
    const filePath = resolveWritableAddonFilePath(targetPath)
    if (!filePath) return { success: false, error: 'INVALID_ADDON_PATH' }

    try {
        await ensureDir(filePath)
        await fsp.writeFile(filePath, String(content ?? ''), 'utf8')
        emitAddonSettingsWriteIfNeeded(filePath)
        return { success: true }
    } catch (error: any) {
        logger?.main?.error?.('[addon-file:write-text]', error)
        return { success: false, error: error?.message || String(error) }
    }
})

ipcMain.handle(MainEvents.ADDON_FILE_READ_BASE64, async (_event, targetPath: string) => {
    const filePath = resolveAddonFilePath(targetPath, { mustExist: true })
    if (!filePath) return null

    try {
        const buffer = await readBufResilient(filePath)
        return buffer.toString('base64')
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            logger?.main?.error?.('[addon-file:read-base64]', error)
        }
        return null
    }
})

ipcMain.handle(MainEvents.ADDON_FILE_WRITE_BASE64, async (_event, targetPath: string, base64: string) => {
    const filePath = resolveWritableAddonFilePath(targetPath)
    if (!filePath || !base64) return false

    try {
        await ensureDir(filePath)
        await fsp.writeFile(filePath, Buffer.from(base64, 'base64'))
        emitAddonSettingsWriteIfNeeded(filePath)
        return true
    } catch (error: any) {
        logger?.main?.error?.('[addon-file:write-base64]', error)
        return false
    }
})

ipcMain.handle(MainEvents.ADDON_FILE_AS_DATA_URL, async (_event, targetPath: string) => {
    const filePath = resolveAddonFilePath(targetPath, { mustExist: true })
    if (!filePath) return null

    try {
        const buffer = await readBufResilient(filePath)
        return `data:${mimeFromExt(filePath)};base64,${buffer.toString('base64')}`
    } catch (error: any) {
        logger?.main?.error?.('[addon-file:as-data-url]', error)
        return null
    }
})

ipcMain.handle(
    MainEvents.ADDON_FILE_COPY_INTO,
    async (
        _event,
        request: {
            addonPath?: string
            existingRelativePath?: string
            preferredName?: string
            sourcePath?: string
        },
    ) => {
        const addonDirectoryPath = resolveAddonDirectoryPath(String(request?.addonPath || ''))
        const sourcePath = resolveInputPath(String(request?.sourcePath || ''))

        if (!addonDirectoryPath || !sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            return { success: false, error: 'INVALID_ADDON_FILE_COPY' }
        }

        try {
            let destinationPath: string | null = null

            if (request?.existingRelativePath) {
                if (path.isAbsolute(request.existingRelativePath)) {
                    return { success: false, error: 'INVALID_ADDON_RELATIVE_PATH' }
                }
                destinationPath = resolveWritableAddonFilePath(path.join(addonDirectoryPath, request.existingRelativePath))
            } else {
                const baseName = sanitizeAddonFilename(request?.preferredName || path.basename(sourcePath))
                const ext = path.extname(baseName)
                const stem = baseName.slice(0, baseName.length - ext.length)
                destinationPath = path.join(addonDirectoryPath, baseName)

                let index = 1
                while (index <= 500 && fs.existsSync(destinationPath)) {
                    destinationPath = path.join(addonDirectoryPath, `${stem}_${index++}${ext}`)
                }
                if (index > 500) {
                    destinationPath = path.join(addonDirectoryPath, `${stem}_${Date.now()}${ext}`)
                }
            }

            if (!destinationPath || !resolvePathInsideBase(addonDirectoryPath, destinationPath)) {
                return { success: false, error: 'INVALID_ADDON_DESTINATION' }
            }

            await ensureDir(destinationPath)
            try {
                const buffer = await readBufResilient(sourcePath)
                await fsp.writeFile(destinationPath, buffer)
            } catch {
                await fsp.copyFile(sourcePath, destinationPath)
            }
            emitAddonSettingsWriteIfNeeded(destinationPath)

            const relativePath = toAddonRelativePath(addonDirectoryPath, destinationPath)
            return relativePath ? { success: true, relativePath } : { success: false, error: 'INVALID_ADDON_DESTINATION' }
        } catch (error: any) {
            logger?.main?.error?.('[addon-file:copy-into]', error)
            return { success: false, error: error?.message || String(error) }
        }
    },
)

ipcMain.handle(
    MainEvents.ADDON_FILE_OPEN_DIALOG,
    async (_event, request?: { defaultPath?: string; filters?: Electron.FileFilter[]; metadata?: boolean }) => {
        const addonsRoot = getAddonsRoot()
        const defaultPath = request?.defaultPath ? resolvePathInsideBase(addonsRoot, resolveInputPath(request.defaultPath)) ?? undefined : undefined
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: request?.filters,
            defaultPath,
        })
        if (canceled || !filePaths.length) return null

        const selectedPath = path.normalize(filePaths[0])
        if (!request?.metadata) {
            return selectedPath
        }

        return resolvePathInsideBase(addonsRoot, selectedPath) ? path.basename(selectedPath) : selectedPath
    },
)

ipcMain.handle(MainEvents.DELETE_ADDON_DIRECTORY, async (_event, themeDirectoryPath: string) => {
    try {
        const addonsRoot = getAddonsRoot()
        const addonDirectoryPath = resolveExistingDirectoryInsideBase(addonsRoot, String(themeDirectoryPath || ''))
        if (!addonDirectoryPath) {
            return { success: false, reason: 'INVALID_ADDON_PATH' }
        }

        const addonDirectoryName = path.basename(addonDirectoryPath)
        if (addonDirectoryName === 'Default') {
            return { success: false, reason: 'DEFAULT_ADDON_DELETE_BLOCKED' }
        }

        if (State.get('addons.theme') === addonDirectoryName) {
            State.set('addons.theme', 'Default')
        }

        const nextScripts = readStoredAddonScripts().filter(script => script !== addonDirectoryName)
        State.set('addons.scripts', nextScripts)

        await fsp.rm(addonDirectoryPath, {
            recursive: true,
            force: true,
        })

        const addons = await loadAddons()
        await syncAddonClients()

        return {
            success: true,
            addons,
            scripts: State.get('addons.scripts') || [],
            theme: State.get('addons.theme') || 'Default',
        }
    } catch (error) {
        logger.main.error('Ошибка при удалении директории темы:', error)
        return { success: false, reason: error instanceof Error ? error.message : 'DELETE_FAILED' }
    }
})

ipcMain.handle(MainEvents.SET_ADDON_ENABLED, async (_event, payload: { directoryName?: string; enabled?: boolean }) => {
    try {
        const directoryName = String(payload?.directoryName || '').trim()
        if (!directoryName) {
            return { success: false, reason: 'ADDON_DIRECTORY_REQUIRED' }
        }

        const addons = await loadAddons()
        const addon = addons.find(item => item.directoryName === directoryName)
        if (!addon) {
            return { success: false, reason: 'ADDON_NOT_FOUND' }
        }

        const enabled = Boolean(payload?.enabled)
        if (addon.type === 'theme') {
            State.set('addons.theme', enabled ? addon.directoryName : 'Default')
        } else {
            const scripts = new Set(readStoredAddonScripts())
            if (enabled) {
                scripts.add(addon.directoryName)
            } else {
                scripts.delete(addon.directoryName)
            }
            State.set('addons.scripts', Array.from(scripts))
        }

        const nextAddons = await loadAddons()
        await syncAddonClients()

        return {
            success: true,
            addons: nextAddons,
            scripts: State.get('addons.scripts') || [],
            theme: State.get('addons.theme') || 'Default',
        }
    } catch (error) {
        logger.main.error('Ошибка при изменении состояния аддона:', error)
        return { success: false, reason: error instanceof Error ? error.message : 'SET_ADDON_ENABLED_FAILED' }
    }
})

ipcMain.on(MainEvents.THEME_CHANGED, async (_event, addon: Addon) => {
    try {
        if (!addon) {
            logger.main.error('Addons: No addon data received')
            return
        }
        const addonsFolder = getAddonsRoot()
        const addonFolder = path.join(addonsFolder, addon.directoryName)
        const metadataPath = path.join(addonFolder, 'metadata.json')

        let validated: Addon
        if (fs.existsSync(metadataPath)) {
            const data = await fsp.readFile(metadataPath, 'utf-8')
            validated = JSON.parse(data) as Addon
            if (!validated.directoryName) {
                validated.directoryName = addon.directoryName
            }
        } else {
            throw new Error(`Metadata file not found for addon ${addon.directoryName}`)
        }

        if (validated.type !== 'theme') {
            logger.main.warn(
                `Addons: Received theme change for addon ${validated.directoryName} with type '${validated.type}'. Reverting to Default theme.`,
            )
            setSelectedAddon('Default')
        } else {
            setSelectedAddon(validated.directoryName)
        }
        logger.main.info(`Addons: theme changed to: ${selectedAddon}`)
        setAddon(selectedAddon)
    } catch (error: any) {
        logger.main.error(`Addons: Error processing theme change: ${error.message}`)
        setSelectedAddon('Default')
        setAddon(selectedAddon)
    }
})
