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
import { checkMusic, getYandexMusicAppDataPath, isLinux, isMac } from '../utils/appUtils'
import Addon from '../../renderer/api/interfaces/addon.interface'
import { installExtension, updateExtensions } from 'electron-chrome-web-store'
import { createSettingsWindow, inSleepMode, mainWindow, settingsWindow } from '../modules/createWindow'
import { loadAddons } from '../utils/addonUtils'
import { isDevmark } from '../../renderer/api/config'
import { getState } from '../modules/state'
import { get_current_track } from '../modules/httpServer'

const updater = getUpdater()
const State = getState()
let reqModal = 0
export let updateAvailable = false
export let authorized = false
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
    const filter = {
        urls: ['*://pulsesync.dev/*', '*://*.pulsesync.dev/*'],
    }
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
    ipcMain.on('electron-window-minimize', () => {
        mainWindow.minimize()
    })
    ipcMain.on('electron-window-exit', () => {
        logger.main.info('Exit app')
        app.quit()
    })

    ipcMain.on('electron-window-maximize', () => {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    })

    ipcMain.on('electron-window-close', (_event, val: boolean) => {
        if (!val) app.quit()
        mainWindow.hide()
    })
}

const registerSettingsEvents = (): void => {
    ipcMain.on('electron-settings-minimize', () => {
        settingsWindow.minimize()
    })

    ipcMain.on('electron-settings-exit', () => {
        logger.main.info('Exit app')
        app.quit()
    })

    ipcMain.on('electron-settings-maximize', () => {
        settingsWindow.isMaximized() ? settingsWindow.unmaximize() : settingsWindow.maximize()
    })

    ipcMain.on('electron-settings-close', (event, val) => {
        if (!val) {
            settingsWindow.close()
        } else {
            settingsWindow.hide()
        }
    })
}

ipcMain.on('before-quit', async () => {
    const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
    if (fs.existsSync(tempFilePath)) {
        fs.rmSync(tempFilePath)
    }
    if (mainWindow) mainWindow.close()
})

const registerSystemEvents = (window: BrowserWindow): void => {
    ipcMain.on('electron-corsanywhereport', event => {
        event.returnValue = corsAnywherePort
    })

    ipcMain.on('electron-isdev', event => {
        event.returnValue = isAppDev || isDevmark
    })

    ipcMain.on('electron-ismac', async (event, args) => {
        event.returnValue = isMac()
    })

    ipcMain.handle('getVersion', async () => {
        return app.getVersion()
    })
    ipcMain.on('getLastBranch', event => {
        event.returnValue = process.env.BRANCH
    })
    ipcMain.on('electron-store-get', (event, val) => {
        event.returnValue = State.get(val)
    })

    ipcMain.on('electron-store-set', (event, key, val) => {
        State.set(key, val)
    })

    ipcMain.on('electron-store-delete', (event, key) => {
        State.delete(key)
    })

    ipcMain.handle('getSystemInfo', async () => ({
        appVersion: app.getVersion(),
        osType: os.type(),
        osRelease: os.release(),
        cpu: os.cpus(),
        memory: os.totalmem(),
        freeMemory: os.freemem(),
        arch: os.arch(),
    }))
    ipcMain.on('ui-ready', () => {
        get_current_track()
    })
}

const registerFileOperations = (window: BrowserWindow): void => {
    ipcMain.on('open-external', async (_event, url: string) => {
        exec(`start "" "${url}"`)
    })

    ipcMain.on('open-file', (_event, markdownContent: string) => {
        const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
        fs.writeFile(tempFilePath, markdownContent, err => {
            if (err) {
                logger.main.error('Error writing to file:', err)
                return
            }
            let command: string
            if (process.platform === 'win32') {
                command = `"${tempFilePath}"`
            } else if (process.platform === 'darwin') {
                command = `open "${tempFilePath}"`
            } else {
                command = `xdg-open "${tempFilePath}"`
            }
            exec(command, error => {
                if (error) {
                    logger.main.error('Error opening the file:', error)
                    return
                }
                fs.unlink(tempFilePath, unlinkErr => {
                    if (unlinkErr) {
                        logger.main.error('Error deleting the file:', unlinkErr)
                    } else {
                        logger.main.log('Temporary file successfully deleted')
                    }
                })
            })
        })
    })

    ipcMain.on('openPath', async (_event, data: any) => {
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
            case 'themePath': {
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

    ipcMain.handle('dialog:openFile', async (_evt, opts?: { filters?: Electron.FileFilter[] }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: opts?.filters,
        })
        if (canceled || !filePaths.length) return null
        return path.normalize(filePaths[0])
    })

    ipcMain.handle('file:asDataUrl', async (_evt, fullPath: string) => {
        if (!fullPath) return null
        try {
            const buf = await fsp.readFile(fullPath)
            const ext = path.extname(fullPath).toLowerCase()
            const mime = mimeByExt[ext] || 'application/octet-stream'
            return `data:${mime};base64,${buf.toString('base64')}`
        } catch (e) {
            console.error('[file:asDataUrl] read error:', e)
            return null
        }
    })
}

const registerMediaEvents = (window: BrowserWindow): void => {
    ipcMain.on('download-yandex-music', async (event, downloadUrl?: string) => {
        let exeUrl = downloadUrl
        if (!exeUrl) {
            const { data } = await axios.get('https://music-desktop-application.s3.yandex.net/stable/latest.yml')
            const match = data.match(/version:\s*([\d.]+)/)
            if (!match) throw new Error('Версия не найдена в latest.yml')
            exeUrl = `https://music-desktop-application.s3.yandex.net/stable/Yandex_Music_x64_${match[1]}.exe`
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
                event.reply('download-music-progress', { progress: Math.round(progress * 100) })
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
                        event.reply('download-music-failure', {
                            success: false,
                            error: `Failed to execute the file: ${error.message}`,
                        })
                        return
                    }
                    event.reply('download-music-execution-success', {
                        success: true,
                        message: 'File executed successfully.',
                    })
                    fs.unlinkSync(downloadPath)
                })
            }, 100)
        } catch (error: any) {
            mainWindow.setProgressBar(-1)
            if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath)
            event.reply('download-music-failure', {
                success: false,
                error: `Error downloading file: ${error.message}`,
            })
        }
    })
}

const registerDeviceEvents = (window: BrowserWindow): void => {
    ipcMain.on('get-music-device', event => {
        si.system().then(data => {
            event.returnValue = `os=${os.type()}; os_version=${os.version()}; manufacturer=${data.manufacturer}; model=${data.model}; clid=WindowsPhone; device_id=${data.uuid}; uuid=${v4(
                {
                    random: Buffer.from(data.uuid),
                },
            )}`
        })
    })

    ipcMain.on('autoStartApp', (_event, enabled: boolean) => {
        if (isAppDev) return
        app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') })
    })

    ipcMain.handle('getMusicStatus', async () => {
        if (isLinux()) {
            return true
        } else {
            return fs.existsSync(musicPath)
        }
    })

    ipcMain.on('checkMusicInstall', () => {
        checkMusic()
    })
}

const registerUpdateEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-install', () => updater.install())

    ipcMain.on('checkUpdate', async (_event, args: { hard?: boolean }) => {
        await checkOrFindUpdate(args?.hard)
    })

    ipcMain.on('updater-start', () => {
        if (isMac()) return
        updater.start()
        updater.onUpdate(version => {
            mainWindow.webContents.send('update-available', version)
            mainWindow.flashFrame(true)
            updateAvailable = true
        })
    })
}

const registerDiscordAndLoggingEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-rpcSettings', async (_event, data: any) => {
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

    ipcMain.on('authStatus', async (_event, data: any) => {
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

    ipcMain.on('renderer-log', (_event, data: any) => {
        if (data.info) logger.renderer.info(data.text)
        else if (data.error) logger.renderer.error(data.text)
        else logger.renderer.log(data.text)
    })

    ipcMain.on('log-error', (_event, errorInfo: any) => {
        HandleErrorsElectron.handleError('renderer-error', errorInfo.type, errorInfo.message, errorInfo.componentStack)
    })
}

const registerNotificationEvents = (window: BrowserWindow): void => {
    ipcMain.on('show-notification', (_event, data: any) => {
        new Notification({ title: data.title, body: data.body }).show()
    })

    ipcMain.handle('needModalUpdate', async () => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        }
        return false
    })
}

const registerLogArchiveEvent = (window: BrowserWindow): void => {
    ipcMain.on('getLogArchive', async () => {
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
            userInfo: {
                username: userInfo.username,
                homedir: userInfo.homedir,
            },
        }

        const systemInfoPath = path.join(logDirPath, 'system-info.json')
        const configPulsePath = path.join(app.getPath('userData'), 'pulsesync_settings.json')
        const configYandexMusicPath = path.join(getYandexMusicAppDataPath(), 'config.json')
        try {
            fs.writeFileSync(systemInfoPath, JSON.stringify(systemInfo, null, 4), 'utf-8')
        } catch (error: any) {
            logger.main.error(`Error while creating system-info.json: ${error.message}`)
        }

        try {
            const zip = new AdmZip()
            zip.addLocalFolder(logDirPath, '', filePath => !filePath.endsWith('.zip') && filePath !== archiveName)
            zip.addLocalFile(configPulsePath, '')
            zip.addLocalFile(configYandexMusicPath, '')
            zip.writeZip(archivePath)
            shell.showItemInFolder(archivePath)
        } catch (error: any) {
            logger.main.error(`Error while creating archive file: ${error}`)
        }
    })
}

const registerSleepModeEvent = (window: BrowserWindow): void => {
    ipcMain.handle('checkSleepMode', async () => inSleepMode)
}

const registerExtensionEvents = (window: BrowserWindow): void => {
    ipcMain.handle('getAddons', async () => {
        try {
            return await loadAddons()
        } catch (error) {
            logger.main.error('Addons: Error loading themes:', error)
        }
    })
    ipcMain.on('open-settings-window', () => {
        createSettingsWindow()
    })
    ipcMain.handle('create-new-extension', async (_event, _args: any) => {
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
            HandleErrorsElectron.handleError('event-handler', 'create-new-extension', 'try-catch', error)
            logger.main.error('Error creating new extension:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('exportAddon', async (_event, data: any) => {
        try {
            if (!fs.existsSync(data.path)) {
                logger.main.error('Folder not found.')
            }

            const zip = new AdmZip()
            zip.addLocalFolder(data.path, '', relativePath => {
                const parts = relativePath.split(path.sep)
                return !parts.includes('.git')
            })

            const outputFilePath = path.join(app.getPath('userData'), 'exports', data.name)
            const outputPath = path.format({
                dir: path.dirname(outputFilePath),
                name: path.basename(outputFilePath, '.pext'),
                ext: '.pext',
            })

            zip.writeZip(outputPath)
            logger.main.info(`Create theme ${outputPath}`)
            shell.showItemInFolder(outputPath)
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
    const status = await updater.check()
    if (status === UpdateStatus.DOWNLOADING) {
        mainWindow.webContents.send('check-update', { updateAvailable: true })
        updateAvailable = true
    } else if (status === UpdateStatus.DOWNLOADED) {
        if (hard) updater.install()
        mainWindow.webContents.send('check-update', { updateAvailable: true })
        updateAvailable = true
        mainWindow.webContents.send('download-update-finished')
    }
}
