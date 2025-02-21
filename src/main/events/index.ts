import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import logger from '../modules/logger'
import path from 'path'
import fs from 'fs'
import * as si from 'systeminformation'
import os from 'os'
import { v4 } from 'uuid'
import { corsAnywherePort, inSleepMode, mainWindow, updated } from '../../index'
import { getUpdater } from '../modules/updater/updater'
import { store } from '../modules/storage'
import { UpdateStatus } from '../modules/updater/constants/updateStatus'
import { rpc_connect, updateAppId } from '../modules/discordRpc'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import isAppDev from 'electron-is-dev'
import { exec, execFile } from 'child_process'
import axios from 'axios'
import { Track } from '../../renderer/api/interfaces/track.interface'
import { downloadTrack } from './handlers/downloadTrack'

const updater = getUpdater()
let reqModal = 0
export let updateAvailable = false
export let authorized = false

const registerWindowEvents = (window: BrowserWindow): void => {
    ipcMain.on('electron-window-minimize', () => {
        mainWindow.minimize()
    })

    ipcMain.on('electron-window-exit', () => {
        logger.main.info('Exit app')
        app.quit()
    })

    ipcMain.on('electron-window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize()
        else mainWindow.maximize()
    })

    ipcMain.on('before-quit', async () => {
        const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
        if (fs.existsSync(tempFilePath)) {
            fs.rmSync(tempFilePath)
        }
        mainWindow.close()
    })

    ipcMain.on('electron-window-close', (event, val) => {
        if (!val) app.quit()
        mainWindow.hide()
    })
}

const registerSystemEvents = (window: BrowserWindow): void => {
    ipcMain.on('electron-corsanywhereport', (event) => {
        event.returnValue = corsAnywherePort
    })

    ipcMain.on('electron-isdev', (event) => {
        event.returnValue = isAppDev
    })

    ipcMain.handle('getVersion', async (event) => {
        const version = app.getVersion()
        if (version) return version
    })

    ipcMain.handle('getSystemInfo', async () => {
        return {
            appVersion: app.getVersion(),
            osType: os.type(),
            osRelease: os.release(),
            cpu: os.cpus(),
            memory: os.totalmem(),
            freeMemory: os.freemem(),
            arch: os.arch(),
        }
    })
}

const registerFileOperations = (window: BrowserWindow): void => {
    ipcMain.on('open-external', async (event, url) => {
        exec(`start "" "${url}"`)
    })

    ipcMain.on('open-file', (event, markdownContent) => {
        const tempFilePath = path.join(os.tmpdir(), 'terms.ru.md')
        fs.writeFile(tempFilePath, markdownContent, (err) => {
            if (err) {
                logger.main.error('Error writing to file:', err)
                return
            }
            let command = ''
            if (process.platform === 'win32') {
                command = `"${tempFilePath}"`
            } else if (process.platform === 'darwin') {
                command = `open "${tempFilePath}"`
            } else {
                command = `xdg-open "${tempFilePath}"`
            }
            exec(command, (error) => {
                if (error) {
                    logger.main.error('Error opening the file:', error)
                    return
                }
                fs.unlink(tempFilePath, (unlinkErr) => {
                    if (unlinkErr) {
                        logger.main.error('Error deleting the file:', unlinkErr)
                    } else {
                        logger.main.log('Temporary file successfully deleted')
                    }
                })
            })
        })
    })

    ipcMain.on('openPath', async (event, data) => {
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
                const themesFolderPath = path.join(
                    app.getPath('appData'),
                    'PulseSync',
                    'themes',
                )
                await shell.openPath(themesFolderPath)
                break
            }
            case 'theme': {
                const themeFolder = path.join(
                    app.getPath('appData'),
                    'PulseSync',
                    'themes',
                    data.themeName,
                )
                await shell.openPath(themeFolder)
                break
            }
        }
    })
}

const registerMediaEvents = (window: BrowserWindow): void => {
    ipcMain.on(
        'download-track',
        async (
            event,
            val: {
                url: string
                track: Track
                askSavePath: boolean
                saveAsMp3: boolean
            },
        ) => {
            await downloadTrack(event, val)
        },
    )

    ipcMain.on('update-yandex-music', async (event, data) => {
        if (!data) {
            event.reply('update-music-failure', {
                success: false,
                error: 'No download URL provided.',
            })
            return
        }
        try {
            const url = data
            const fileName = path.basename(url)
            const downloadPath = path.join(
                app.getPath('appData'),
                'PulseSync',
                'downloads',
                fileName,
            )
            fs.mkdirSync(path.dirname(downloadPath), { recursive: true })
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
            })
            const totalLength = response.headers['content-length']
            let downloadedLength = 0
            const writer = fs.createWriteStream(downloadPath)
            response.data.on('data', (chunk: string | any[]) => {
                downloadedLength += chunk.length
                const progress = downloadedLength / totalLength
                event.reply('update-music-progress', {
                    progress: Math.round(progress * 100),
                })
                mainWindow.setProgressBar(progress)
            })
            response.data.pipe(writer)
            writer.on('finish', () => {
                writer.close()
                mainWindow.setProgressBar(-1)
                fs.chmodSync(downloadPath, 0o755)
                setTimeout(() => {
                    execFile(downloadPath, (error) => {
                        if (error) {
                            event.reply('update-music-failure', {
                                success: false,
                                error: `Failed to execute the file: ${error.message}`,
                            })
                            return
                        }
                        event.reply('update-music-execution-success', {
                            success: true,
                            message: 'File executed successfully.',
                        })
                        fs.unlinkSync(downloadPath)
                    })
                }, 100)
            })
            writer.on('error', (error) => {
                fs.unlinkSync(downloadPath)
                mainWindow.setProgressBar(-1)
                event.reply('update-music-failure', {
                    success: false,
                    error: `Error saving file: ${error.message}`,
                })
            })
        } catch (error) {
            mainWindow.setProgressBar(-1)
            event.reply('update-music-failure', {
                success: false,
                error: `Error downloading file: ${error.message}`,
            })
        }
    })
}

const registerDeviceEvents = (window: BrowserWindow): void => {
    ipcMain.on('get-music-device', (event) => {
        si.system().then((data) => {
            event.returnValue = `os=${os.type()}; os_version=${os.version()}; manufacturer=${data.manufacturer}; model=${data.model}; clid=WindowsPhone; device_id=${data.uuid}; uuid=${v4({ random: Buffer.from(data.uuid) })}`
        })
    })

    ipcMain.on('autoStartApp', async (event, data) => {
        app.setLoginItemSettings({
            openAtLogin: data,
            path: app.getPath('exe'),
        })
    })
}

const registerUpdateEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-install', () => {
        updater.install()
    })

    ipcMain.on('checkUpdate', async () => await checkOrFindUpdate())

    ipcMain.on('updater-start', async (event, data) => {
        await checkOrFindUpdate()
        updater.start()
        updater.onUpdate((version) => {
            mainWindow.webContents.send('update-available', version)
            mainWindow.flashFrame(true)
            updateAvailable = true
        })
    })
}

const registerDiscordAndLoggingEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-rpcSettings', async (event, data) => {
        switch (Object.keys(data)[0]) {
            case 'appId':
                updateAppId(data.appId)
                break
            case 'details':
                store.set('discordRpc.details', data.details)
                break
            case 'state':
                store.set('discordRpc.state', data.state)
                break
            case 'button':
                store.set('discordRpc.button', data.button)
                break
        }
    })

    ipcMain.on('authStatus', async (event, data) => {
        if (data && store.get('discordRpc.status')) {
            await rpc_connect()
        }
        authorized = data
    })

    ipcMain.on('renderer-log', async (event, data) => {
        switch (Object.keys(data)[0]) {
            case 'info':
                logger.renderer.info(data.text)
                break
            case 'error':
                logger.renderer.error(data.text)
                break
            case 'log':
                logger.renderer.log(data.text)
                break
        }
    })

    ipcMain.on('log-error', (event, errorInfo) => {
        const logMessage = `[${errorInfo.type}] ${errorInfo.message}\n${errorInfo.stack || ''}\n\n`
        logger.crash.error(logMessage)
    })
}

const registerNotificationEvents = (window: BrowserWindow): void => {
    ipcMain.on('show-notification', async (event, data) => {
        return new Notification({ title: data.title, body: data.body }).show()
    })

    ipcMain.handle('needModalUpdate', async (event) => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        } else return false
    })
}

const registerLogArchiveEvent = (window: BrowserWindow): void => {
    ipcMain.on('getLogArchive', async (event) => {
        const logDirPath = path.join(app.getPath('appData'), 'PulseSync', 'logs')
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const archiveName = `logs-${year}-${month}-${day}.zip`
        const archivePath = path.join(logDirPath, archiveName)
        const userInfo = os.userInfo()
        const systemInfo = {
            appVersion: app.getVersion(),
            osType: os.type(),
            osRelease: os.release(),
            cpu: os.cpus(),
            memory: os.totalmem(),
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
        try {
            fs.writeFileSync(
                systemInfoPath,
                JSON.stringify(systemInfo, null, 2),
                'utf-8',
            )
        } catch (error) {
            logger.main.error(
                `Error while creating system-info.json: ${error.message}`,
            )
        }
        try {
            const output = fs.createWriteStream(archivePath)
            const archive = archiver('zip', { zlib: { level: 9 } })
            output.on('close', () => {
                shell.showItemInFolder(archivePath)
            })
            archive.on('error', (err) => {
                logger.main.error(
                    `Error while creating archive file: ${err.message}`,
                )
            })
            archive.pipe(output)
            archive.glob('**/*', {
                cwd: logDirPath,
                ignore: ['*.zip', archiveName],
            })
            await archive.finalize()
        } catch (error) {
            logger.main.error(`Error while creating archive file: ${error.message}`)
        }
    })
}

const registerSleepModeEvent = (window: BrowserWindow): void => {
    ipcMain.handle('checkSleepMode', async (event, data) => {
        return inSleepMode
    })
}

const registerExtensionEvents = (window: BrowserWindow): void => {
    ipcMain.handle('create-new-extension', async (event, args) => {
        try {
            const defaultAddon = {
                name: 'New Extension',
                image: 'test.png',
                banner: 'test.png',
                author: 'Your Name',
                version: '1.0.0',
                description: 'Default theme.',
                css: 'style.css',
                script: 'script.js',
                tags: ['PulseSync'],
            }
            const defaultCssContent = `{}`
            const defaultScriptContent = ``
            const extensionsPath = path.join(
                app.getPath('appData'),
                'PulseSync',
                'themes',
            )
            if (!fs.existsSync(extensionsPath)) {
                fs.mkdirSync(extensionsPath)
            }
            const defaultName = 'New Extension'
            let newName = defaultName
            let counter = 1
            const existingExtensions = fs.readdirSync(extensionsPath)
            while (existingExtensions.includes(newName)) {
                counter++
                newName = `${defaultName} ${counter}`
                defaultAddon.name = newName
            }
            const extensionPath = path.join(extensionsPath, newName)
            fs.mkdirSync(extensionPath)
            fs.writeFileSync(
                path.join(extensionPath, 'metadata.json'),
                JSON.stringify(defaultAddon, null, 2),
            )
            fs.writeFileSync(
                path.join(extensionPath, 'style.css'),
                defaultCssContent,
            )
            fs.writeFileSync(
                path.join(extensionPath, 'script.js'),
                defaultScriptContent,
            )
            return { success: true, name: newName }
        } catch (error) {
            logger.main.error('Error creating new extension:', error)
            return { success: false, error: error.message }
        }
    })

    ipcMain.handle('exportAddon', async (event, data) => {
        try {
            if (!fs.existsSync(data.path)) {
                logger.main.error('Folder not found.')
            }
            const zip = new AdmZip()
            zip.addLocalFolder(data.path)
            const outputFilePath = path.join(
                app.getPath('userData'),
                'exports',
                data.name,
            )
            const outputPath = path.format({
                dir: path.dirname(outputFilePath),
                name: path.basename(outputFilePath, '.pext'),
                ext: '.pext',
            })
            zip.writeZip(outputPath)
            logger.main.info(`Create theme ${outputFilePath}`)
            shell.showItemInFolder(outputPath)
            return true
        } catch (error) {
            logger.main.error('Error while creating archive file', error.message)
        }
    })
}

export const handleEvents = (window: BrowserWindow): void => {
    registerWindowEvents(window)
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

export const handleAppEvents = (window: BrowserWindow): void => {
    handleEvents(window)
}

export const checkOrFindUpdate = async () => {
    logger.updater.info('Check update')
    const checkUpdate = await updater.check()
    if (checkUpdate === UpdateStatus.DOWNLOADING) {
        mainWindow.webContents.send('check-update', {
            updateAvailable: true,
        })
        updateAvailable = true
    } else if (checkUpdate === UpdateStatus.DOWNLOADED) {
        mainWindow.webContents.send('check-update', {
            updateAvailable: true,
        })
        updateAvailable = true
        mainWindow.webContents.send('download-update-finished')
    }
}
