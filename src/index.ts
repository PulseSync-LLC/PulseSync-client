import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import process from 'process'
import path from 'path'
import * as fs from 'original-fs'
import createTray from './main/modules/tray'
import config from './config.json'
import { checkForSingleInstance } from './main/modules/singleInstance'
import * as Sentry from '@sentry/electron/main'
import { sendAddon, setAddon } from './main/modules/httpServer'
import { checkAsar, formatJson, getPathToYandexMusic, isLinux, isWindows } from './main/utils/appUtils'
import logger from './main/modules/logger'
import isAppDev from 'electron-is-dev'
import { modManager } from './main/modules/mod/modManager'
import { HandleErrorsElectron } from './main/modules/handlers/handleErrorsElectron'
import * as dns from 'node:dns'

import { checkCLIArguments } from './main/utils/processUtils'
import { initializeCorsAnywhere, registerSchemes } from './main/utils/serverUtils'
import { createDefaultAddonIfNotExists } from './main/utils/addonUtils'
import { checkAndAddPulseSyncOnStartup, setupPulseSyncDialogHandler } from './main/utils/hostFileUtils'
import { createWindow, mainWindow } from './main/modules/createWindow'
import { handleEvents } from './main/events'
import Addon from './renderer/api/interfaces/addon.interface'
import { getState } from './main/modules/state'
import { startThemeWatcher } from './main/modules/nativeModules'
import * as fsp from 'fs/promises'
import MainEvents from './common/types/mainEvents'
import RendererEvents from './common/types/rendererEvents'

export let corsAnywherePort: string | number
export let updated = false
export let hardwareAcceleration = false
export let musicPath: string
export let asarFilename = 'app.backup.asar'
export let asarBackup: string
export let selectedAddon: string

registerSchemes()

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1'])
app.commandLine.appendSwitch('dns-server', '8.8.8.8,8.8.4.4,1.1.1.1,1.0.0.1')

app.setAppUserModelId('pulsesync.app')

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
const checkOldYandexMusic = async () => {
    try {
        const { findAppByName } = await import('./main/utils/appUtils')
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
        logger.main.error('Ошибка при получении пути:', err)
    }
}
initializeMusicPath()

const sentryPrefix = 'app:///'
const sentryRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.resolve(__dirname, '..', '..')

if (!isAppDev) {
    logger.main.info('Sentry enabled')
    Sentry.init({
        dsn: config.SENTRY_DSN,
        debug: isAppDev,
        release: `pulsesync@${app.getVersion()}`,
        environment: isAppDev ? 'development' : 'production',
        attachStacktrace: true,
        enableRendererProfiling: true,
        attachScreenshot: true,
        integrations: [
            Sentry.rewriteFramesIntegration({
                root: sentryRoot,
                prefix: sentryPrefix,
            }),
        ],
    })
    Sentry.setTag('process', 'main')
} else {
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

        corsAnywherePort = await initializeCorsAnywhere()
        updated = checkCLIArguments(isAppDev)
        await createWindow()
        await checkForSingleInstance()
        handleEvents(mainWindow)
        if (isWindows()) {
            await checkOldYandexMusic()
        }
        setupPulseSyncDialogHandler()
        if (isWindows()) {
            checkAndAddPulseSyncOnStartup(mainWindow).catch(err => {
                logger.main.warn('Failed to check pulsesync on startup:', err)
            })
        }
        modManager(mainWindow)
        createTray()
    } catch (e) {
        HandleErrorsElectron.handleError('prestartCheck', 'checkYandexMusicApp', 'app_startup', e)
        logger.main.error('Ошибка при запуске приложения:', e)
    }
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        ipcMain.emit(MainEvents.DISCORDRPC_CLEARSTATE)
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
const resolveInputPath = (p0: string): string => {
    if (!p0) return ''
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
    for (const c of variants) {
        return c
    }
    return norm
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

ipcMain.handle(MainEvents.FILE_EVENT, async (_event, eventType, filePath, data) => {
    try {
        switch (eventType) {
            case RendererEvents.CHECK_FILE_EXISTS: {
                if (!filePath) return false
                try {
                    const p = resolveInputPath(filePath)
                    await fsp.access(p, fs.constants.F_OK)
                    return true
                } catch {
                    return false
                }
            }

            case RendererEvents.READ_FILE: {
                if (!filePath) return null
                try {
                    const p = resolveInputPath(filePath)
                    const enc = (data?.encoding as BufferEncoding) || 'utf8'
                    return await fsp.readFile(p, enc)
                } catch (error) {
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
                } catch (error) {
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

    if (!State.get('discordRpc.appId')) {
        State.set('discordRpc.appId', '')
    }
    if (!State.get('settings.closeAppInTray')) {
        State.set('settings.closeAppInTray', true)
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
