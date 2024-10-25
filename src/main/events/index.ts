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
import TrackInterface from '../../renderer/api/interfaces/track.interface'
import https from 'https'
import { getPercent } from '../../renderer/utils/percentage'
import fs from 'fs'
import * as si from 'systeminformation'
import os from 'os'
import { v4 } from 'uuid'
import { corsAnywherePort, inSleepMode, mainWindow, updated } from '../../index'
import { getUpdater } from '../modules/updater/updater'
import checkAndTerminateYandexMusic, {
    getPathToYandexMusic,
} from '../../../utils/appUtils'
import Patcher from '../modules/patcher/patch'
import { store } from '../modules/storage'
import UnPatcher from '../modules/patcher/unpatch'
import { UpdateStatus } from '../modules/updater/constants/updateStatus'
import { updateAppId } from '../modules/discordRpc'
import archiver from 'archiver'
import { Track } from 'yandex-music-client'

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

    ipcMain.on('electron-patch', async () => {
        await checkAndTerminateYandexMusic()
        setTimeout(async () => {
            await Patcher.patchRum().then(async () => {
                store.set('patcher.patched', true)
                mainWindow.webContents.send('UPDATE_APP_DATA', {
                    patch: true,
                })
            })
        }, 2000)
    })

    ipcMain.on('electron-repatch', async () => {
        await checkAndTerminateYandexMusic()
        const musicPath = await getPathToYandexMusic()
        const asarCopy = path.join(musicPath, 'app.asar.copy')
        if (!fs.existsSync(asarCopy)) {
            setTimeout(async () => {
                await Patcher.patchRum().then(async () => {
                    store.set('patcher.patched', true)
                    mainWindow.webContents.send('UPDATE_APP_DATA', {
                        patch: true,
                    })
                })
            }, 2000)
        } else {
            setTimeout(async () => {
                await UnPatcher.unpatch()
                setTimeout(async () => {
                    Patcher.patchRum().then(async () => {
                        store.set('patcher.patched', true)
                        mainWindow.webContents.send('UPDATE_APP_DATA', {
                            repatch: true,
                        })
                    })
                }, 3000)
            }, 2000)
        }
    })
    ipcMain.on('electron-depatch', async () => {
        await checkAndTerminateYandexMusic()
        setTimeout(async () => {
            await UnPatcher.unpatch().then(async () => {
                store.set('patcher.patched', false)
                mainWindow.webContents.send('UPDATE_APP_DATA', {
                    depatch: true,
                })
            })
        }, 2000)
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
            val: { url: string; track: TrackInterface; trackInfo: Track },
        ) => {
            const musicDir = app.getPath('music')
            const downloadDir = path.join(musicDir, 'PulseSyncMusic')
            dialog
                .showSaveDialog(mainWindow, {
                    title: 'Сохранить как',
                    defaultPath: path.join(
                        downloadDir,
                        `${val.track.playerBarTitle.replace(new RegExp('[?"/\\\\*:\\|<>]', 'g'), '')} - ${val.track.artist.replace(new RegExp('[?"/\\\\*:\\|<>]', 'g'), '')}.mp3`,
                    ),
                    filters: [{ name: 'Трек', extensions: ['mp3'] }],
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
    ipcMain.on('send-crashreport', async (event, data) => {
        // TODO: add c++ module for crash reporter
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
            uptime: os.uptime(),
            networkInterfaces: os.networkInterfaces(),
            networkStats: await si.networkStats(),
            fsSize: await si.fsSize(),
            osInfo: await si.osInfo(),
            battery: await si.battery(),
            memInfo: await si.mem(),
            userInfo: {
                username: userInfo.username,
                homedir: userInfo.homedir,
                shell: userInfo.shell,
                uid: userInfo.uid,
                gid: userInfo.gid,
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
