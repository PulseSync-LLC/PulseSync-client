import { app, BrowserWindow, dialog, ipcMain, Notification, shell, session, session as electronSession } from 'electron'
import logger from '../modules/logger'
import path from 'path'
import fs from 'original-fs'
import * as fsp from 'fs/promises'
import * as si from 'systeminformation'
import os from 'node:os'
import { v4 } from 'uuid'
import { musicPath, readBufResilient, updated } from '../../index'
import { getUpdater } from '../modules/updater/updater'
import { UpdateStatus } from '../modules/updater/constants/updateStatus'
import AdmZip from 'adm-zip'
import isAppDev from 'electron-is-dev'
import { execFile } from 'child_process'
import axios from 'axios'
import { HandleErrorsElectron } from '../modules/handlers/handleErrorsElectron'
import {
    checkMusic,
    findAppByName,
    getInstalledYmMetadata,
    getLinuxInstallerUrl,
    getYandexMusicAppDataPath,
    getYandexMusicLogsPath,
    isLinux,
    isMac,
    uninstallApp,
} from '../utils/appUtils'
import Addon from '../../renderer/api/interfaces/addon.interface'
import { installExtension, updateExtensions } from 'electron-chrome-web-store'
import { createSettingsWindow, inSleepMode, mainWindow, settingsWindow } from '../modules/createWindow'
import { loadAddons } from '../utils/addonUtils'
import config, { branch, isDevmark } from '@common/appConfig'
import { getState } from '../modules/state'
import { get_current_track } from '../modules/httpServer'
import { getMacUpdater } from '../modules/updater/macOsUpdater'
import MainEvents from '../../common/types/mainEvents'
import RendererEvents from '../../common/types/rendererEvents'
import { obsWidgetManager } from '../modules/obsWidget/obsWidgetManager'
import { YM_SETUP_DOWNLOAD_URLS } from '../constants/urls'
import { t } from '../i18n'
import { importPextFile, isPextFilePath } from '../modules/pextImporter'

const updater = getUpdater()
const State = getState()
let reqModal = 0
export let updateAvailable = false
export let authorized = false
let uiReady = false
let pendingAddonOpen: string | null = null

const macManifestUrl = `${config.S3_URL}/builds/app/${branch}/download.json`
const macUpdater = isMac()
    ? getMacUpdater({
          manifestUrl: macManifestUrl,
          appName: 'PulseSync',
          attemptAutoInstall: false,
          onProgress: p => {
              try {
                  if (mainWindow) {
                      mainWindow.setProgressBar(p / 100)
                      mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, p)
                  }
              } catch {}
          },
          onStatus: s => {
              if (s === UpdateStatus.DOWNLOADING) {
                  mainWindow?.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true })
                  updateAvailable = true
              } else if (s === UpdateStatus.DOWNLOADED) {
                  mainWindow?.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                  updateAvailable = true
                  try {
                      if (mainWindow) mainWindow.setProgressBar(-1)
                  } catch {}
              }
          },
          onLog: m => logger.updater.info(m),
      })
    : null

export const getPath = (args: string) => {
    const savePath = app.getPath('userData')
    return path.resolve(`${savePath}/extensions/${args}`)
}

function launchExtensionBackgroundWorkers(session = electronSession.defaultSession) {
    return Promise.all(
        session.extensions.getAllExtensions().map(async extension => {
            const manifest = extension.manifest
            if (manifest.manifest_version === 3 && manifest?.background?.service_worker) {
                await session.serviceWorkers.startWorkerForScope(extension.url)
            }
        }),
    )
}

async function registerAppReadyEvents(): Promise<void> {
    const filter = { urls: ['*://pulsesync.dev/*', '*://*.pulsesync.dev/*'] }
    session.defaultSession.webRequest.onErrorOccurred(filter, details => {
        logger.http.error(`HTTP ERROR: ${details.error} — ${details.method} ${details.url} (from ${details.webContentsId})`)
    })
    if (isAppDev) {
        try {
            await installExtension('fmkadmapgofadopljbjfkapdkoienihi')
            await updateExtensions()
            await launchExtensionBackgroundWorkers()
        } catch (e) {
            logger.main.error(e)
        }
    }
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

export const queueAddonOpen = (addonName: string): void => {
    pendingAddonOpen = addonName
    tryOpenPendingAddon()
}

const tryOpenPendingAddon = (): void => {
    if (!authorized || !uiReady || !pendingAddonOpen || !mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(RendererEvents.OPEN_ADDON, pendingAddonOpen)
    pendingAddonOpen = null
}

const allowedExternalProtocols = new Set(['http:', 'https:', 'yandexmusic:'])
const allowedMusicHosts = new Set(['desktop.app.music.yandex.net'])

const isSafeExternalUrl = (rawUrl: string): boolean => {
    try {
        const url = new URL(rawUrl)
        return allowedExternalProtocols.has(url.protocol)
    } catch {
        return false
    }
}

const isAllowedMusicDownloadUrl = (rawUrl: string): boolean => {
    try {
        const url = new URL(rawUrl)
        if (url.protocol !== 'https:') return false
        if (!allowedMusicHosts.has(url.hostname)) return false
        return (
            /^\/stable\/Yandex_Music_x64_[\d.]+\.exe$/i.test(url.pathname) ||
            /^\/stable\/Yandex_Music_universal_[\d.]+\.dmg$/i.test(url.pathname) ||
            /^\/stable\/Yandex_Music_amd64_[\d.]+\.deb$/i.test(url.pathname)
        )
    } catch {
        return false
    }
}

const resolveWithinBase = (baseDir: string, target: string): string | null => {
    const resolved = path.resolve(baseDir, target)
    const normalizedBase = path.resolve(baseDir)
    if (resolved === normalizedBase) return resolved
    return resolved.startsWith(normalizedBase + path.sep) ? resolved : null
}

const registerWindowEvents = (): void => {
    ipcMain.on(MainEvents.ELECTRON_WINDOW_MINIMIZE, () => {
        mainWindow.minimize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_EXIT, () => {
        logger.main.info(t('main.events.exitApp'))
        app.quit()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_MAXIMIZE, () => {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_CLOSE, (_event, val: boolean) => {
        if (val) {
            mainWindow.hide()
            return
        }

        app.quit()
    })
}

const registerSettingsEvents = (): void => {
    ipcMain.on(MainEvents.ELECTRON_SETTINGS_MINIMIZE, () => {
        settingsWindow.minimize()
    })
    ipcMain.on(MainEvents.ELECTRON_SETTINGS_EXIT, () => {
        logger.main.info(t('main.events.exitApp'))
        app.quit()
    })
    ipcMain.on(MainEvents.ELECTRON_SETTINGS_MAXIMIZE, () => {
        settingsWindow.isMaximized() ? settingsWindow.unmaximize() : settingsWindow.maximize()
    })
    ipcMain.on(MainEvents.ELECTRON_SETTINGS_CLOSE, (event, val) => {
        if (!val) settingsWindow.close()
        else settingsWindow.hide()
    })
}
const registerSystemEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.ELECTRON_ISDEV, event => {
        event.returnValue = isAppDev || isDevmark
    })
    ipcMain.on(MainEvents.ELECTRON_ISMAC, async (event, args) => {
        event.returnValue = isMac()
    })
    ipcMain.handle(MainEvents.GET_VERSION, async () => app.getVersion())
    ipcMain.on(MainEvents.ELECTRON_ISLINUX, async (event, args) => {
        event.returnValue = isLinux()
    })
    ipcMain.on(MainEvents.GET_LAST_BRANCH, event => {
        event.returnValue = process.env.BRANCH
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_GET, (event, val) => {
        event.returnValue = State.get(val)
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_SET, (event, key, val) => {
        State.set(key, val)
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_DELETE, (event, key) => {
        State.delete(key)
    })
    ipcMain.handle(MainEvents.GET_SYSTEM_INFO, async () => ({
        appVersion: app.getVersion(),
        osType: os.type(),
        osRelease: os.release(),
        cpu: os.cpus(),
        memory: os.totalmem(),
        freeMemory: os.freemem(),
        arch: os.arch(),
    }))
    ipcMain.on(MainEvents.UI_READY, () => {
        uiReady = true
        tryOpenPendingAddon()
        get_current_track()
    })
}

const registerFileOperations = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.OPEN_EXTERNAL, async (_event, url: string) => {
        try {
            if (!isSafeExternalUrl(url)) {
                logger.main.warn(`Blocked opening external URL: ${url}`)
                return
            }
            await shell.openExternal(url)
        } catch (error) {
            logger.main.error('Error opening external URL:', error)
        }
    })

    ipcMain.on(MainEvents.OPEN_FILE, (_event, markdownContent: string) => {
        const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
        fsp.writeFile(tempFilePath, markdownContent)
            .then(async () => {
                const openError = await shell.openPath(tempFilePath)
                if (openError) {
                    logger.main.error(`Error opening the file: ${openError}`)
                }
                setTimeout(async () => {
                    try {
                        await fsp.unlink(tempFilePath)
                        logger.main.log('Temporary file successfully deleted')
                    } catch (unlinkErr: any) {
                        if (unlinkErr?.code !== 'ENOENT') {
                            logger.main.error('Error deleting the file:', unlinkErr)
                        }
                    }
                }, 10000)
            })
            .catch(err => {
                logger.main.error('Error writing to file:', err)
            })
    })

    ipcMain.on(MainEvents.OPEN_PATH, async (_event, data: any) => {
        switch (data.action) {
            case 'openApplications': {
                await shell.openPath('/Applications')
                break
            }
            case 'openPath': {
                if (typeof data.path === 'string' && data.path.trim().length > 0) {
                    await shell.openPath(data.path)
                }
                break
            }
            case 'appPath': {
                const appPath = app.getAppPath()
                const pulseSyncPath = path.resolve(appPath, '../..')
                await shell.openPath(pulseSyncPath)
                break
            }
            case 'musicPath': {
                const musicDir = app.getPath('music')
                const downloadDir = path.join(musicDir, 'PulseSyncMusic')
                await shell.openPath(downloadDir)
                break
            }
            case 'addonsPath': {
                const themesFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                await shell.openPath(themesFolderPath)
                break
            }
            case 'theme': {
                const addonsRoot = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                const safeThemePath = resolveWithinBase(addonsRoot, data.themeName || '')
                if (!safeThemePath) {
                    logger.main.warn(`Blocked opening theme path: ${data.themeName}`)
                    break
                }
                await shell.openPath(safeThemePath)
                break
            }
            case 'obsWidgetPath': {
                const widgetPath = path.join(app.getPath('appData'), 'PulseSync', 'obs-widget')
                await shell.openPath(widgetPath)
                break
            }
            case 'privacySettings': {
                if (isMac()) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy')
                }
                break
            }
        }
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_FILE, async (_evt, opts?: { filters?: Electron.FileFilter[]; defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: opts?.filters,
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null
        return path.normalize(filePaths[0])
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_DIRECTORY, async (_evt, opts?: { defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null
        return path.normalize(filePaths[0])
    })

    ipcMain.handle(MainEvents.DIALOG_SAVE_FILE, async (_evt, opts?: { filters?: Electron.FileFilter[]; defaultPath?: string }) => {
        const { canceled, filePath } = await dialog.showSaveDialog({
            filters: opts?.filters,
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePath) return null
        return path.normalize(filePath)
    })

    ipcMain.handle(MainEvents.FILE_AS_DATA_URL, async (_evt, fullPath: string) => {
        if (!fullPath) return null
        try {
            const buf = await (async () => {
                return await readBufResilient(fullPath)
            })()
            const ext = path.extname(fullPath).toLowerCase()
            const mime = (mimeByExt as any)?.[ext] || 'application/octet-stream'
            return `data:${mime};base64,${buf.toString('base64')}`
        } catch (e) {
            console.error('[file:asDataUrl] resilient read error:', e)
            return null
        }
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_FILE_METADATA, async (_evt, opts?: { filters?: Electron.FileFilter[]; defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: opts?.filters,
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null

        const [fullPath] = filePaths
        const normalizedPath = path.normalize(fullPath)
        const searchSubstr = path.join('PulseSync', 'addons') + path.sep

        return normalizedPath.includes(searchSubstr) ? path.basename(normalizedPath) : normalizedPath
    })
}

const registerMediaEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.DOWNLOAD_YANDEX_MUSIC, async (event, downloadUrl?: string) => {
        let exeUrl = downloadUrl
        if (!exeUrl) {
            const { data } = await axios.get('https://desktop.app.music.yandex.net/stable/latest.yml')
            const match = data.match(/version:\s*([\d.]+)/)
            if (!match) throw new Error(t('main.events.latestYmlVersionNotFound'))
            exeUrl = isMac()
                ? `https://desktop.app.music.yandex.net/stable/Yandex_Music_universal_${match[1]}.dmg`
                : isLinux()
                  ? await getLinuxInstallerUrl()
                  : `https://desktop.app.music.yandex.net/stable/Yandex_Music_x64_${match[1]}.exe`
        } else if (!isAllowedMusicDownloadUrl(exeUrl)) {
            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, { success: false, error: t('main.events.invalidDownloadUrl') })
            return
        }

        const fileName = path.basename(exeUrl)
        const downloadPath = path.join(app.getPath('appData'), 'PulseSync', 'downloads', fileName)

        try {
            await fs.promises.mkdir(path.dirname(downloadPath), { recursive: true })
            const response = await axios.get(exeUrl, { responseType: 'stream' })
            const totalLength = parseInt(response.headers['content-length'] || '0', 10)
            let downloadedLength = 0
            const writer = fs.createWriteStream(downloadPath)

            response.data.on('data', (chunk: Buffer) => {
                downloadedLength += chunk.length
                const progress = downloadedLength / totalLength
                event.reply(RendererEvents.DOWNLOAD_MUSIC_PROGRESS, { progress: Math.round(progress * 100) })
                mainWindow.setProgressBar(progress)
            })

            await new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve)
                writer.on('error', reject)
                response.data.pipe(writer)
            })

            writer.close()
            mainWindow.setProgressBar(-1)
            fs.chmodSync(downloadPath, 0o755)

            setTimeout(async () => {
                if (process.platform === 'win32') {
                    execFile(downloadPath, error => {
                        if (error) {
                            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                                success: false,
                                error: t('main.events.fileExecuteFailed', { message: error.message }),
                            })
                            return
                        }
                        event.reply(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                            success: true,
                            message: t('main.events.fileExecutedSuccessfully'),
                        })
                        fs.unlinkSync(downloadPath)
                    })
                    return
                }

                const openError = await shell.openPath(downloadPath)
                if (openError) {
                    event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                        success: false,
                        error: t('main.events.fileOpenFailed', { message: openError }),
                    })
                    return
                }
                event.reply(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, {
                    success: true,
                    message: t('main.events.fileOpenedSuccessfully'),
                })
                fs.unlinkSync(downloadPath)
            }, 100)
        } catch (error: any) {
            mainWindow.setProgressBar(-1)
            if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath)
            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, {
                success: false,
                error: t('main.events.fileDownloadError', { message: error.message }),
            })
        }
    })
}

const registerDeviceEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.GET_MUSIC_DEVICE, event => {
        si.system().then(data => {
            event.returnValue = `os=${os.type()}; os_version=${os.version()}; manufacturer=${data.manufacturer}; model=${data.model}; clid=WindowsPhone; device_id=${data.uuid}; uuid=${v4(
                { random: Buffer.from(data.uuid) },
            )}`
        })
    })

    ipcMain.on(MainEvents.AUTO_START_APP, (_event, enabled: boolean) => {
        if (isAppDev) return
        if (isLinux()) return
        app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') })
    })

    ipcMain.handle(MainEvents.GET_MUSIC_STATUS, async () => {
        if (isLinux()) return true
        else return fs.existsSync(musicPath)
    })

    ipcMain.handle(MainEvents.GET_MUSIC_VERSION, async () => {
        const metadata = await getInstalledYmMetadata()
        return metadata?.version
    })

    ipcMain.on(MainEvents.CHECK_MUSIC_INSTALL, () => {
        checkMusic()
    })
}

const registerUpdateEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.UPDATE_INSTALL, async () => {
        if (isMac()) {
            try {
                const installInfo = await macUpdater?.installUpdate()
                if (installInfo && mainWindow) {
                    mainWindow.webContents.send(RendererEvents.MAC_UPDATE_READY, installInfo)
                }
            } catch (e: any) {
                logger.updater.error(`macOS install error: ${e?.message || e}`)
            }
            return
        }
        updater.install()
    })

    ipcMain.on(MainEvents.CHECK_UPDATE, async (_event, args: { hard?: boolean; manual?: boolean }) => {
        await checkOrFindUpdate(args?.hard, args?.manual)
    })

    ipcMain.on(MainEvents.UPDATER_START, async () => {
        if (isMac()) {
            try {
                const m = await macUpdater?.checkForUpdates()
                if (m) {
                    mainWindow.webContents.send(RendererEvents.UPDATE_AVAILABLE, m.version)
                    mainWindow.flashFrame(true)
                    updateAvailable = true
                }
            } catch (e: any) {
                logger.updater.error(`macOS updater-start error: ${e?.message || e}`)
            }
            return
        }
        updater.start()
        updater.onUpdate(version => {
            mainWindow.webContents.send(RendererEvents.UPDATE_AVAILABLE, version)
            mainWindow.flashFrame(true)
            updateAvailable = true
        })
    })
}

const registerLoggingEvents = (window: BrowserWindow): void => {
    const formatRendererLogMessage = (prefix: string, payload: Record<string, any> | null | undefined) => {
        const text = payload?.text ?? payload?.message ?? ''
        const details: string[] = []
        const type = payload?.type ? `type=${payload.type}` : null
        if (type) details.push(type)
        if (payload?.stack) details.push(`stack:\n${payload.stack}`)
        if (payload?.componentStack) details.push(`componentStack:\n${payload.componentStack}`)
        const detailText = details.length ? `\n${details.join('\n')}` : ''
        return `[${prefix}] ${text}${detailText}`.trim()
    }

    ipcMain.on(MainEvents.AUTH_STATUS, (_event, data: any) => {
        authorized = data.status
        tryOpenPendingAddon()
    })

    ipcMain.on(MainEvents.RENDERER_LOG, (_event, data: any) => {
        const message = formatRendererLogMessage('RENDERER_LOG', data)
        const level = data?.error ? 'error' : data?.info ? 'info' : 'log'
        logger.renderer[level](message)
    })

    ipcMain.on(MainEvents.LOG_ERROR, (_event, errorInfo: any) => {
        const message = formatRendererLogMessage('LOG_ERROR', errorInfo)
        logger.renderer.error(message)
        const errorMessage = errorInfo?.message ?? t('main.events.rendererError')
        const error = new Error(errorMessage)
        if (errorInfo?.stack) {
            const componentStack = errorInfo?.componentStack ? `\nComponentStack:\n${errorInfo.componentStack}` : ''
            error.stack = `${errorInfo.stack}${componentStack}`
        }
        HandleErrorsElectron.handleError('renderer-error', errorInfo?.type ?? 'unknown', 'error-boundary', error)
    })
}

const registerNotificationEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.SHOW_NOTIFICATION, (_event, data: any) => {
        new Notification({ title: data.title, body: data.body }).show()
    })
    ipcMain.handle(MainEvents.NEED_MODAL_UPDATE, async () => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        }
        return false
    })
}

const registerLogArchiveEvent = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.GET_LOG_ARCHIVE, async () => {
        try {
            const logDirPath = path.join(app.getPath('appData'), 'PulseSync', 'logs')
            const now = new Date()
            const year = now.getFullYear()
            const month = String(now.getMonth() + 1).padStart(2, '0')
            const day = String(now.getDate()).padStart(2, '0')
            const archiveName = `logs-${year}-${month}-${day}.zip`
            const archivePath = path.join(logDirPath, archiveName)
            const userInfo = os.userInfo()
            const gpuData = await si.graphics()

            const systemInfo = {
                appVersion: app.getVersion(),
                osType: os.type(),
                osRelease: os.release(),
                cpu: os.cpus(),
                gpu: gpuData.controllers,
                freeMemory: os.freemem(),
                arch: os.arch(),
                platform: os.platform(),
                osInfo: await si.osInfo(),
                memInfo: await si.mem(),
                userInfo: { username: userInfo.username, homedir: userInfo.homedir },
            }

            const systemInfoPath = path.join(logDirPath, 'system-info.json')
            const configPulsePath = path.join(app.getPath('userData'), 'pulsesync_settings.json')
            const configYandexMusicPath = path.join(getYandexMusicAppDataPath(), 'config.json')
            const logsYandexMusicPath = getYandexMusicLogsPath()

            fs.writeFileSync(systemInfoPath, JSON.stringify(systemInfo, null, 4), 'utf-8')

            const zip = new AdmZip()
            zip.addLocalFolder(logDirPath, '', filePath => !filePath.endsWith('.zip') && filePath !== archiveName)
            zip.addLocalFolder(logsYandexMusicPath, 'yandexmusic/logs')
            zip.addLocalFile(configPulsePath, '')
            zip.addLocalFile(configYandexMusicPath, 'yandexmusic/')
            zip.writeZip(archivePath)
            shell.showItemInFolder(archivePath)
        } catch (error: any) {
            logger.main.error(`Error while creating archive file: ${error}`)
        }
    })
}

const registerSleepModeEvent = (window: BrowserWindow): void => {
    ipcMain.handle(MainEvents.CHECK_SLEEP_MODE, async () => inSleepMode)
}

const registerExtensionEvents = (window: BrowserWindow): void => {
    ipcMain.handle(MainEvents.GET_ADDONS, async () => {
        try {
            return await loadAddons()
        } catch (error) {
            logger.main.error(t('main.events.addonsLoadError'), error)
        }
    })
    ipcMain.on(MainEvents.OPEN_SETTINGS_WINDOW, () => {
        createSettingsWindow()
    })
    ipcMain.handle(MainEvents.CREATE_NEW_EXTENSION, async (_event, _args: any) => {
        try {
            const defaultAdd: Partial<Addon> = {
                name: t('main.events.newExtensionName'),
                image: '',
                banner: '',
                author: t('main.events.newExtensionAuthor'),
                version: '1.0.0',
                description: t('main.events.newExtensionDescription'),
                css: 'style.css',
                script: 'script.js',
                type: 'theme',
                tags: ['PulseSync'],
                dependencies: [],
            }
            const defaultCssContent = `{}`
            const defaultScriptContent = ``
            const extensionsPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
            if (!fs.existsSync(extensionsPath)) fs.mkdirSync(extensionsPath)
            let newName = t('main.events.newExtensionName')
            let counter = 1
            while (fs.readdirSync(extensionsPath).includes(newName)) {
                counter++
                newName = t('main.events.newExtensionNameWithIndex', { index: counter })
                defaultAdd.name = newName
            }
            const extensionPath = path.join(extensionsPath, newName)
            fs.mkdirSync(extensionPath)
            fs.writeFileSync(path.join(extensionPath, 'metadata.json'), JSON.stringify(defaultAdd, null, 4))
            fs.writeFileSync(path.join(extensionPath, 'style.css'), defaultCssContent)
            fs.writeFileSync(path.join(extensionPath, 'script.js'), defaultScriptContent)
            return { success: true, name: newName }
        } catch (error: any) {
            HandleErrorsElectron.handleError('event-handler', MainEvents.CREATE_NEW_EXTENSION, 'try-catch', error)
            logger.main.error(t('main.events.createExtensionError'), error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle(MainEvents.EXPORT_ADDON, async (_event, data: any) => {
        try {
            if (!fs.existsSync(data.path)) {
                logger.main.error(t('main.events.folderNotFound'))
            }

            const zip = new AdmZip()

            zip.addLocalFolder(data.path, '', relativePath => {
                if (!relativePath) return true
                const parts = relativePath.split(path.sep)
                return !parts.some(p => p.startsWith('.'))
            })

            const exportsDir = path.join(app.getPath('userData'), 'exports')
            if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true })

            const outputFilePath = path.join(exportsDir, data.name)
            const outputPath = path.format({
                dir: path.dirname(outputFilePath),
                name: path.basename(outputFilePath, '.pext'),
                ext: '.pext',
            })

            zip.writeZip(outputPath)
            logger.main.info(`Create theme ${outputPath}`)
            shell.showItemInFolder(outputPath)

            try {
                const zipPath = path.format({
                    dir: path.dirname(outputFilePath),
                    name: path.basename(outputFilePath, '.pext'),
                    ext: '.zip',
                })

                zip.writeZip(zipPath)
                logger.main.info(`Create zip ${zipPath}`)
                shell.showItemInFolder(zipPath)
            } catch (errZip: any) {
                logger.main.error(t('main.events.createZipError'), errZip)
            }

            return true
        } catch (error: any) {
            logger.main.error(t('main.events.createArchiveError'), error.message)
            return false
        }
    })

    ipcMain.handle(MainEvents.IMPORT_PEXT_FILE, async (_event, rawPath: string) => {
        try {
            if (!isPextFilePath(rawPath)) {
                return { success: false, reason: 'INVALID_FILE' }
            }
            const addonName = await importPextFile(rawPath)
            if (!addonName) {
                return { success: false, reason: 'IMPORT_FAILED' }
            }
            queueAddonOpen(addonName)
            return { success: true, addonName }
        } catch (error: any) {
            logger.main.error('Failed to import .pext from renderer drop:', error)
            return { success: false, reason: error?.message || 'IMPORT_FAILED' }
        }
    })
}

const registerYandexMusicEvents = (window: BrowserWindow): void => {
    ipcMain.on('DELETE_YANDEX_MUSIC_APP', async _event => {
        try {
            logger.main.info(t('main.events.yandexUninstallStart'))

            const namePart = 'Yandex.Music'
            const pkg = await findAppByName(namePart)

            if (!pkg) {
                logger.main.warn(t('main.events.yandexNotFound'))
                window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                    success: false,
                    message: t('main.events.yandexNotFoundMessage'),
                })
                return
            }

            try {
                logger.main.info(`Uninstalling Yandex Music: ${pkg.PackageFullName}`)
                await uninstallApp(pkg.PackageFullName)

                logger.main.info(t('main.events.yandexUninstallSuccess'))
                window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                    success: true,
                    message: t('main.events.yandexUninstallSuccessMessage'),
                })
            } catch (uninstallErr) {
                logger.main.error(`Uninstall error: ${(uninstallErr as Error).message}`)
                window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                    success: false,
                    message: t('main.events.yandexUninstallFailedWithReason', { message: (uninstallErr as Error).message }),
                })
            }
        } catch (error: any) {
            logger.main.error(`Uninstall exception: ${error.message}`)
            window.webContents.send('DELETE_YANDEX_MUSIC_RESULT', {
                success: false,
                message: t('main.events.yandexUninstallError'),
            })
        }
    })
}

export const handleEvents = (window: BrowserWindow): void => {
    registerWindowEvents()
    registerSettingsEvents()
    registerAppReadyEvents()
    registerSystemEvents(window)
    registerFileOperations(window)
    registerMediaEvents(window)
    registerDeviceEvents(window)
    registerUpdateEvents(window)
    registerLoggingEvents(window)
    registerNotificationEvents(window)
    registerLogArchiveEvent(window)
    registerSleepModeEvent(window)
    registerExtensionEvents(window)
    registerYandexMusicEvents(window)
    obsWidgetManager(window, app)
}

export const checkOrFindUpdate = async (hard?: boolean, manual = false) => {
    logger.updater.info('Check update')
    if (isMac()) {
        try {
            const macUpdaterInstance = await macUpdater?.checkForUpdates()
            if (macUpdaterInstance) {
                mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
                updateAvailable = true
                try {
                    await macUpdater?.downloadUpdate(macUpdaterInstance)
                    mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                    if (hard) {
                        const installInfo = await macUpdater?.installUpdate(macUpdaterInstance)
                        if (installInfo && mainWindow) {
                            mainWindow.webContents.send(RendererEvents.MAC_UPDATE_READY, installInfo)
                        }
                    }
                } catch (e: any) {
                    logger.updater.error(`macOS download/install error: ${e?.message || e}`)
                    try {
                        if (mainWindow) mainWindow.setProgressBar(-1)
                    } catch {}
                }
            } else {
                mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            }
        } catch (e: any) {
            logger.updater.error(`macOS check error: ${e?.message || e}`)
        }
        return
    }
    const status = await updater.check(manual)
    if (status === UpdateStatus.DOWNLOADING) {
        mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
        updateAvailable = true
    } else if (status === UpdateStatus.DOWNLOADED) {
        if (hard) updater.install()
        mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
        updateAvailable = true
        mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
    }
}
