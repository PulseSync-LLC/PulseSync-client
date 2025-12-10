import { app, BrowserWindow, dialog, ipcMain, Notification, shell, session, session as electronSession } from 'electron'
import logger from '../modules/logger'
import path from 'path'
import fs from 'original-fs'
import * as fsp from 'fs/promises'
import * as si from 'systeminformation'
import os from 'node:os'
import { v4 } from 'uuid'
import { corsAnywherePort, musicPath, updated } from '../../index'
import { getUpdater } from '../modules/updater/updater'
import { UpdateStatus } from '../modules/updater/constants/updateStatus'
import { rpc_connect, rpcConnected, updateAppId } from '../modules/discordRpc'
import AdmZip from 'adm-zip'
import isAppDev from 'electron-is-dev'
import { exec, execFile } from 'child_process'
import axios from 'axios'
import * as Sentry from '@sentry/electron/main'
import { HandleErrorsElectron } from '../modules/handlers/handleErrorsElectron'
import { checkMusic, getInstalledYmMetadata, getYandexMusicAppDataPath, getYandexMusicMetadata, isLinux, isMac, isWindows } from '../utils/appUtils'
import Addon from '../../renderer/api/interfaces/addon.interface'
import { installExtension, updateExtensions } from 'electron-chrome-web-store'
import { createSettingsWindow, inSleepMode, mainWindow, settingsWindow } from '../modules/createWindow'
import { loadAddons } from '../utils/addonUtils'
import config, { branch, isDevmark } from '../../renderer/api/web_config'
import { getState } from '../modules/state'
import { get_current_track } from '../modules/httpServer'
import { getMacUpdater } from '../modules/updater/macOsUpdater'
import MainEvents from '../../common/types/mainEvents'
import RendererEvents from '../../common/types/rendererEvents'

const updater = getUpdater()
const State = getState()
let reqModal = 0
export let updateAvailable = false
export let authorized = false
const macManifestUrl = `${config.S3_URL}/builds/app/${branch}/download.json`
const macUpdater = isMac()
    ? getMacUpdater({
          manifestUrl: macManifestUrl,
          appName: 'PulseSync',
          attemptAutoInstall: false,
          openFinderOnMount: true,
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

const registerWindowEvents = (): void => {
    ipcMain.on(MainEvents.ELECTRON_WINDOW_MINIMIZE, () => {
        mainWindow.minimize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_EXIT, () => {
        logger.main.info('Exit app')
        app.quit()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_MAXIMIZE, () => {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_CLOSE, (_event, val: boolean) => {
        if (!val) app.quit()
        mainWindow.hide()
    })
}

const registerSettingsEvents = (): void => {
    ipcMain.on(MainEvents.ELECTRON_SETTINGS_MINIMIZE, () => {
        settingsWindow.minimize()
    })
    ipcMain.on(MainEvents.ELECTRON_SETTINGS_EXIT, () => {
        logger.main.info('Exit app')
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

ipcMain.on(MainEvents.BEFORE_QUIT, async () => {
    const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
    if (fs.existsSync(tempFilePath)) fs.rmSync(tempFilePath)
    if (mainWindow) mainWindow.close()
})

const registerSystemEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.ELECTRON_CORSANYWHEREPORT, event => {
        event.returnValue = corsAnywherePort
    })
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
        get_current_track()
    })
}

const readBufResilient = async (p0: string): Promise<Buffer> => {
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

const registerFileOperations = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.OPEN_EXTERNAL, async (_event, url: string) => {
        exec(`start "" "${url}"`)
    })

    ipcMain.on(MainEvents.OPEN_FILE, (_event, markdownContent: string) => {
        const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
        fs.writeFile(tempFilePath, markdownContent, err => {
            if (err) {
                logger.main.error('Error writing to file:', err)
                return
            }
            let command: string
            if (process.platform === 'win32') command = `"${tempFilePath}"`
            else if (process.platform === 'darwin') command = `open "${tempFilePath}"`
            else command = `xdg-open "${tempFilePath}"`
            exec(command, error => {
                if (error) {
                    logger.main.error('Error opening the file:', error)
                    return
                }
                fs.unlink(tempFilePath, unlinkErr => {
                    if (unlinkErr) logger.main.error('Error deleting the file:', unlinkErr)
                    else logger.main.log('Temporary file successfully deleted')
                })
            })
        })
    })

    ipcMain.on(MainEvents.OPEN_PATH, async (_event, data: any) => {
        switch (data.action) {
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
                const themeFolder = path.join(app.getPath('appData'), 'PulseSync', 'addons', data.themeName)
                await shell.openPath(themeFolder)
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
            if (!match) throw new Error('Версия не найдена в latest.yml')
            exeUrl = `https://desktop.app.music.yandex.net/stable/Yandex_Music_x64_${match[1]}.exe`
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

            setTimeout(() => {
                execFile(downloadPath, error => {
                    if (error) {
                        event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, { success: false, error: `Failed to execute the file: ${error.message}` })
                        return
                    }
                    event.reply(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, { success: true, message: 'File executed successfully.' })
                    fs.unlinkSync(downloadPath)
                })
            }, 100)
        } catch (error: any) {
            mainWindow.setProgressBar(-1)
            if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath)
            event.reply(RendererEvents.DOWNLOAD_MUSIC_FAILURE, { success: false, error: `Error downloading file: ${error.message}` })
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
        app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') })
    })

    ipcMain.handle(MainEvents.GET_MUSIC_STATUS, async () => {
        if (isLinux()) return true
        else return fs.existsSync(musicPath)
    })

    ipcMain.handle(MainEvents.GET_MUSIC_VERSION, async () => {
        const metadata = await getInstalledYmMetadata()
        console.log(metadata)
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
                await macUpdater?.installUpdate()
            } catch (e: any) {
                logger.updater.error(`macOS install error: ${e?.message || e}`)
            }
            return
        }
        updater.install()
    })

    ipcMain.on(MainEvents.CHECK_UPDATE, async (_event, args: { hard?: boolean }) => {
        await checkOrFindUpdate(args?.hard)
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

const registerDiscordAndLoggingEvents = (window: BrowserWindow): void => {
    ipcMain.on(MainEvents.UPDATE_RPC_SETTINGS, async (_event, data: any) => {
        switch (Object.keys(data)[0]) {
            case 'appId':
                updateAppId(data.appId)
                break
            case 'details':
                State.set('discordRpc.details', data.details)
                break
            case 'state':
                State.set('discordRpc.state', data.state)
                break
            case 'button':
                State.set('discordRpc.button', data.button)
                break
            case 'statusDisplayType':
                State.set('discordRpc.statusDisplayType', data.statusDisplayType)
                break
        }
    })

    ipcMain.on(MainEvents.AUTH_STATUS, async (_event, data: any) => {
        if (data?.status && State.get('discordRpc.status') && rpcConnected) {
            await rpc_connect()
        }
        authorized = data.status
        if (data?.user) {
            Sentry.setUser({ id: data.user.id, username: data.user.username, email: data.user.email })
        } else {
            Sentry.setUser(null)
        }
    })

    ipcMain.on(MainEvents.RENDERER_LOG, (_event, data: any) => {
        if (data.info) logger.renderer.info(data.text)
        else if (data.error) logger.renderer.error(data.text)
        else logger.renderer.log(data.text)
    })

    ipcMain.on(MainEvents.LOG_ERROR, (_event, errorInfo: any) => {
        HandleErrorsElectron.handleError('renderer-error', errorInfo.type, errorInfo.message, errorInfo.componentStack)
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
            const logsYandexMusicPath = path.join(getYandexMusicAppDataPath(), 'logs')

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
            logger.main.error('Addons: Error loading themes:', error)
        }
    })
    ipcMain.on(MainEvents.OPEN_SETTINGS_WINDOW, () => {
        createSettingsWindow()
    })
    ipcMain.handle(MainEvents.CREATE_NEW_EXTENSION, async (_event, _args: any) => {
        try {
            const defaultAdd: Partial<Addon> = {
                name: 'New Extension',
                image: '',
                banner: '',
                author: 'Your Name',
                version: '1.0.0',
                description: 'Default theme.',
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
            let newName = 'New Extension'
            let counter = 1
            while (fs.readdirSync(extensionsPath).includes(newName)) {
                counter++
                newName = `New Extension ${counter}`
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
            logger.main.error('Error creating new extension:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle(MainEvents.EXPORT_ADDON, async (_event, data: any) => {
        try {
            if (!fs.existsSync(data.path)) {
                logger.main.error('Folder not found.')
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
                logger.main.error('Error while creating .zip file with AdmZip', errZip)
            }

            return true
        } catch (error: any) {
            logger.main.error('Error while creating archive file', error.message)
            return false
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
    registerDiscordAndLoggingEvents(window)
    registerNotificationEvents(window)
    registerLogArchiveEvent(window)
    registerSleepModeEvent(window)
    registerExtensionEvents(window)
}

export const checkOrFindUpdate = async (hard?: boolean) => {
    logger.updater.info('Check update')
    if (isMac()) {
        try {
            const m = await macUpdater?.checkForUpdates()
            if (m) {
                mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true })
                updateAvailable = true
                try {
                    await macUpdater?.downloadUpdate(m)
                    mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                    if (hard) await macUpdater?.installUpdate(m)
                } catch (e: any) {
                    logger.updater.error(`macOS download/install error: ${e?.message || e}`)
                    try {
                        if (mainWindow) mainWindow.setProgressBar(-1)
                    } catch {}
                }
            } else {
                mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: false })
            }
        } catch (e: any) {
            logger.updater.error(`macOS check error: ${e?.message || e}`)
        }
        return
    }
    const status = await updater.check()
    if (status === UpdateStatus.DOWNLOADING) {
        mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true })
        updateAvailable = true
    } else if (status === UpdateStatus.DOWNLOADED) {
        if (hard) updater.install()
        mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: true })
        updateAvailable = true
        mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
    }
}
