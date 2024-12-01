import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell,
    Notification,
} from 'electron'
import logger from '../modules/logger'
import path from 'path'
import https from 'https'
import { getPercent } from '../../renderer/utils/percentage'
import fs from 'fs'
import * as si from 'systeminformation'
import os from 'os'
import { v4 } from 'uuid'
import { corsAnywherePort, inSleepMode, mainWindow, updated } from '../../index'
import { getUpdater } from '../modules/updater/updater'
import { store } from '../modules/storage'
import { UpdateStatus } from '../modules/updater/constants/updateStatus'
import { updateAppId } from '../modules/discordRpc'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import { Track } from '../../renderer/api/interfaces/track.interface'

const updater = getUpdater()
let reqModal = 0
export let authorized = false
export const handleEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-install', () => {
        updater.install()
    })

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

    ipcMain.on('electron-window-close', () => {
        mainWindow.hide()
    })

    ipcMain.on('electron-corsanywhereport', event => {
        event.returnValue = corsAnywherePort
    })
    ipcMain.handle('getVersion', async event => {
        const version = app.getVersion()
        if (version) return version
    })
    ipcMain.on('openPath', async (event, data) => {
        switch (data) {
            case 'appPath':
                const appPath = app.getAppPath()
                const pulseSyncPath = path.resolve(appPath, '../..')
                await shell.openPath(pulseSyncPath)
                break
            case 'musicPath':
                const musicDir = app.getPath('music')
                const downloadDir = path.join(musicDir, 'PulseSyncMusic')
                await shell.openPath(downloadDir)
                break
            case 'themePath':
                const themesFolderPath = path.join(
                    app.getPath('appData'),
                    'PulseSync',
                    'themes',
                )
                await shell.openPath(themesFolderPath)
                break
        }
    })

    ipcMain.on(
        'download-track',
        (
            event,
            val: { url: string; track: Track;/*  trackInfo: Track */ },
        ) => {
            const musicDir = app.getPath('music');
            const downloadDir = path.join(musicDir, 'PulseSyncMusic');
            const fileExtension = val.url.split('/').reverse()[0];
            dialog
                .showSaveDialog(mainWindow, {
                    title: 'Сохранить как',
                    defaultPath: path.join(
                        downloadDir,
                        `${val.track.title.replace(new RegExp('[?"/\\\\*:\\|<>]', 'g'), '')} - ${val.track.artists.map((x) => x.name).join(", ").replace(new RegExp('[?"/\\\\*:\\|<>]', 'g'), '')}.${fileExtension}`,
                    ),
                    filters: [{ name: 'Трек', extensions: [fileExtension] }],
                })
                .then(result => {
                    if (!result.canceled)
                        https.get(val.url, response => {
                            const totalFileSize = parseInt(
                                response.headers['content-length'],
                                10,
                            )
                            let downloadedBytes = 0

                            response.on('data', chunk => {
                                downloadedBytes += chunk.length
                                const percent = getPercent(
                                    downloadedBytes,
                                    totalFileSize,
                                )
                                mainWindow.setProgressBar(percent / 100)
                                mainWindow.webContents.send(
                                    'download-track-progress',
                                    percent,
                                )
                            })
                            response
                                .pipe(fs.createWriteStream(result.filePath))
                                .on('finish', () => {
                                    mainWindow.webContents.send(
                                        'download-track-finished',
                                    )

                                    shell.showItemInFolder(result.filePath)
                                    mainWindow.setProgressBar(-1)
                                })
                        })
                    else mainWindow.webContents.send('download-track-cancelled')
                })
                .catch(() =>
                    mainWindow.webContents.send('download-track-failed'),
                )
        },
    )
    ipcMain.on('get-music-device', event => {
        si.system().then(data => {
            event.returnValue = `os=${os.type()}; os_version=${os.version()}; manufacturer=${
                data.manufacturer
            }; model=${data.model}; clid=WindowsPhone; device_id=${
                data.uuid
            }; uuid=${v4({ random: Buffer.from(data.uuid) })}`
        })
    })
    ipcMain.on('autoStartApp', async (event, data) => {
        app.setLoginItemSettings({
            openAtLogin: data,
            path: app.getPath('exe'),
        })
    })
    ipcMain.on('checkUpdate', async () => await checkOrFindUpdate())
    ipcMain.on('updater-start', async (event, data) => {
        await checkOrFindUpdate()
        updater.start()
        updater.onUpdate(version => {
            mainWindow.webContents.send('update-available', version)
        })
    })
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
    ipcMain.on('show-notification', async (event, data) => {
        return new Notification({ title: data.title, body: data.body }).show()
    })
    ipcMain.handle('needModalUpdate', async event => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        } else return false
    })
    ipcMain.on('authStatus', async (event, data) => {
        console.log('authStatus', data)
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
    ipcMain.on('getLogArchive', async event => {
        const logDirPath = path.join(
            app.getPath('appData'),
            'PulseSync',
            'logs',
        )

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

            archive.on('error', err => {
                logger.main.error(
                    `Error while creating archive file: ${err.message}`,
                )
            })

            archive.pipe(output)
            archive.directory(logDirPath, false)
            await archive.finalize()
        } catch (error) {
            logger.main.error(
                `Error while creating archive file: ${error.message}`,
            )
        }
    })
    ipcMain.handle('checkSleepMode', async (event, data) => {
        return inSleepMode
    })
    ipcMain.handle('exportTheme', async (event, data) => {
        /**
         * Создаёт файл с расширением .pext, содержащий папку по указанному пути
         * @param folderPath Путь к папке, которую нужно заархивировать
         * @param outputFilePath Путь для сохранения созданного файла с расширением .pext
         */
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
            logger.main.error(
                'Error while creating archive file',
                error.message,
            )
        }
    })
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
    } else if (checkUpdate === UpdateStatus.DOWNLOADED) {
        mainWindow.webContents.send('check-update', {
            updateAvailable: true,
        })
        mainWindow.webContents.send('download-update-finished')
    }
}
