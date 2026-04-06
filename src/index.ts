import { app, BrowserWindow, ipcMain } from 'electron'
import process from 'process'
import path from 'path'
import * as fs from 'original-fs'
import createTray from './main/modules/tray'
import {
    checkForSingleInstance,
    consumePendingBrowserAuthFromDeepLink,
    consumePendingInstallModUpdateFromPath,
    isFirstInstance,
} from './main/modules/singleInstance'
import { sendAddonSettings, sendAllAddonSettings, setAddon } from './main/modules/httpServer'
import { checkAsar, findAppByName, getPathToYandexMusic, isLinux, isMac, isWindows } from './main/utils/appUtils'
import logger from './main/modules/logger'
import isAppDev from './main/utils/isAppDev'
import { modManager } from './main/modules/mod/modManager'
import { HandleErrorsElectron } from './main/modules/handlers/handleErrorsElectron'

import { checkCLIArguments } from './main/utils/processUtils'
import { registerSchemes } from './main/utils/serverUtils'
import { createDefaultAddonIfNotExists } from './main/utils/addonUtils'
import { createWindow, mainWindow } from './main/modules/createWindow'
import { handleEvents } from './main/events'
import { initMainI18n, t } from './main/i18n'
import Addon from '@entities/addon/model/addon.interface'
import { getState } from './main/modules/state'
import { startThemeWatcher } from './main/modules/nativeModules'
import * as fsp from 'fs/promises'
import MainEvents from './common/types/mainEvents'
import RendererEvents from './common/types/rendererEvents'
import { installModUpdateFromAsar } from './main/modules/mod/installModUpdateFrom'
import { processBrowserAuth } from './main/modules/auth/browserAuth'
import { runWhenUiReady } from './main/modules/uiReady'
import { sendAppStartupTelemetry } from './main/modules/telemetry/appTelemetry'

export let updated = false
export let musicPath: string
export let asarFilename = 'app.backup.asar'
export let asarBackup: string
export let selectedAddon: string

registerSchemes()
initMainI18n()

if (isWindows()) {
    app.setAppUserModelId('pulsesync.app')
}

const State = getState()

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
            mainWindow.webContents.send('SHOW_YANDEX_MUSIC_UPDATE_DIALOG')
        }
    } catch (err) {
        HandleErrorsElectron.handleError('prestartCheck', 'checkOldYandexMusic', 'app_startup', err)
    }
}

const initializeMusicPath = async () => {
    try {
        musicPath = await getPathToYandexMusic()
        asarBackup = path.join(musicPath, asarFilename)
    } catch (err) {
        logger.main.error(t('main.index.musicPathError'), err)
    }
}
initializeMusicPath()

if (isAppDev && (isWindows() || isMac())) {
    const openAtLogin = app.getLoginItemSettings().openAtLogin
    if (openAtLogin) {
        app.setLoginItemSettings({
            openAtLogin: false,
            path: app.getPath('exe'),
        })
    }
}

app.on('ready', async () => {
    try {
        HandleErrorsElectron.processStoredCrashes()
        await initializeMusicPath()

        updated = checkCLIArguments(isAppDev)
        await checkForSingleInstance()
        if (!isFirstInstance) {
            return
        }
        await createWindow()
        handleEvents(mainWindow)
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
    } catch (e) {
        HandleErrorsElectron.handleError('prestartCheck', 'checkYandexMusicApp', 'app_startup', e)
        logger.main.error(t('main.index.appStartupError'), e)
    }
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

function initializeAddon() {
    selectedAddon = State.get('addons.theme') || 'Default'
    logger.main.log('Addons: theme changed to:', selectedAddon)
    setAddon(selectedAddon)
}

const ensureDir = async (p: string) => fsp.mkdir(path.dirname(p), { recursive: true })
const safeJson = (obj: any) => {
    try {
        return JSON.stringify(obj, null, 4)
    } catch {
        return String(obj ?? '')
    }
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
export const readBufResilient = async (p0: string): Promise<Buffer> => {
    if (!p0) throw new Error('empty path')
    const candidates: string[] = []
    if (p0.startsWith('file://')) {
        try {
            const u = new URL(p0)
            candidates.push(path.normalize(decodeURI(u.pathname)))
        } catch {}
    }
    const norm = path.normalize(p0)
    candidates.push(norm)
    if (process.platform === 'win32') {
        candidates.push(norm.replace(/\//g, '\\'))
        candidates.push(norm.replace(/\\/g, '/'))
        if (!norm.startsWith('\\\\?\\')) candidates.push('\\\\?\\' + norm)
    }
    try {
        candidates.push(norm.normalize('NFC'))
    } catch {}
    try {
        candidates.push(norm.normalize('NFD'))
    } catch {}
    candidates.push(norm.replace(/^["']|["']$/g, ''))
    let lastErr: any = null
    for (const p of candidates) {
        try {
            return await fsp.readFile(p)
        } catch (e1) {
            lastErr = e1
            try {
                const buf = await new Promise<Buffer>((resolve, reject) => {
                    fs.readFile(p, (err, data) => (err ? reject(err) : resolve(data as unknown as Buffer)))
                })
                return buf
            } catch (e2) {
                lastErr = e2
            }
        }
    }
    throw lastErr ?? new Error('Unable to read file')
}
const mimeFromExt = (p: string) => {
    const ext = path.extname(p).toLowerCase()
    return (mimeByExt as any)?.[ext] || 'application/octet-stream'
}

const HANDLE_EVENTS_FILENAME = 'handleEvents.json'

const emitAddonSettingsWriteIfNeeded = (writtenPath: string): void => {
    if (!writtenPath) return

    const normalizedPath = path.normalize(writtenPath)
    if (path.basename(normalizedPath).toLowerCase() !== HANDLE_EVENTS_FILENAME.toLowerCase()) {
        return
    }

    const addonsRoot = path.join(app.getPath('appData'), 'PulseSync', 'addons')
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

ipcMain.handle(MainEvents.DELETE_ADDON_DIRECTORY, async (_event, themeDirectoryPath) => {
    try {
        if (fs.existsSync(themeDirectoryPath)) {
            await fsp.rm(themeDirectoryPath, {
                recursive: true,
                force: true,
            })
            return { success: true }
        } else {
            logger.main.error('Директория темы не найдена.')
        }
    } catch (error) {
        logger.main.error('Ошибка при удалении директории темы:', error)
    }
})

ipcMain.on(MainEvents.THEME_CHANGED, async (_event, addon: Addon) => {
    try {
        if (!addon) {
            logger.main.error('Addons: No addon data received')
            return
        }
        const addonsFolder = path.join(app.getPath('appData'), 'PulseSync', 'addons')
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
            selectedAddon = 'Default'
        } else {
            selectedAddon = validated.directoryName
        }
        logger.main.info(`Addons: theme changed to: ${selectedAddon}`)
        setAddon(selectedAddon)
    } catch (error: any) {
        logger.main.error(`Addons: Error processing theme change: ${error.message}`)
        selectedAddon = 'Default'
        setAddon(selectedAddon)
    }
})

export async function prestartCheck() {
    const musicDir = app.getPath('music')
    const pulseSyncMusicPath = path.join(musicDir, 'PulseSyncMusic')

    if (!fs.existsSync(pulseSyncMusicPath)) {
        try {
            fs.mkdirSync(pulseSyncMusicPath, { recursive: true })
        } catch (err) {
            logger.main.error('Ошибка при создании директории PulseSyncMusic:', err)
        }
    }

    if (isLinux() && State.get('settings.modFilename')) {
        const modFilename = State.get('settings.modFilename')
        asarFilename = `${modFilename}.backup.asar`
        asarBackup = path.join(musicPath, asarFilename)
    }

    if (typeof State.get('settings.closeAppInTray') !== 'boolean') {
        State.set('settings.closeAppInTray', false)
    }
    checkAsar()
    initializeAddon()

    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    createDefaultAddonIfNotExists(themesPath)
    try {
        startThemeWatcher(themesPath)
    } catch (e) {
        logger.main.error('Error setting up file watcher for themes:', e)
    }
}
