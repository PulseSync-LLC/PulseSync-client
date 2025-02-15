import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
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
import { rpc_connect, updateAppId } from '../modules/discordRpc'
import archiver from 'archiver'
import AdmZip from 'adm-zip'
import { Track } from '../../renderer/api/interfaces/track.interface'
import NodeID3, { Tags } from 'node-id3'
import ffmpeg from 'fluent-ffmpeg'
import isAppDev from 'electron-is-dev'
import { exec, execFile } from 'child_process'
import axios from 'axios'
import { decryptData } from '../../renderer/utils/track'

const updater = getUpdater()
let reqModal = 0
const ffmpegPath = isAppDev
    ? path.join(__dirname, '..', '..', 'modules', 'ffmpeg.exe')
    : path.join(__dirname, '..', '..', '..', '..', 'modules', 'ffmpeg.exe')
export let updateAvailable = false
ffmpeg.setFfmpegPath(ffmpegPath)
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

    ipcMain.on('electron-corsanywhereport', (event) => {
        event.returnValue = corsAnywherePort
    })
    ipcMain.on('electron-isdev', (event) => {
        event.returnValue = isAppDev
    })
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

            const child = exec(command, (error) => {
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
    ipcMain.handle('getVersion', async (event) => {
        const version = app.getVersion()
        if (version) return version
    })
    ipcMain.on('openPath', async (event, data) => {
        switch (data.action) {
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
            case 'theme':
                const themeFolder = path.join(
                    app.getPath('appData'),
                    'PulseSync',
                    'themes',
                    data.themeName,
                )
                await shell.openPath(themeFolder)
                break
        }
    })

    ipcMain.on(
        'download-track',
        (
            event,
            val: {
                url: string
                track: Track & { downloadInfo?: { transport: string; key: string } }
                metadata: boolean
            },
        ) => {
            const musicDir = app.getPath('music')
            const downloadDir = path.join(musicDir, 'PulseSyncMusic')

            function getExtensionFromUrl(url: string): string {
                const cleanUrl = url.split('?')[0]
                let filenamePart = cleanUrl.split('/').pop()?.toLowerCase() || ''

                if (filenamePart.includes('-mp4')) {
                    filenamePart = filenamePart.replace('-mp4', '')
                    if (filenamePart.includes('.')) {
                        return filenamePart.split('.').pop() || ''
                    } else {
                        return filenamePart
                    }
                } else {
                    if (filenamePart.includes('.')) {
                        return filenamePart.split('.').pop() || ''
                    } else {
                        return filenamePart
                    }
                }
            }
            const fileExtension = getExtensionFromUrl(val.url) || 'mp3'
            const safeTitle = val.track.title.replace(/[?"/\\*:\|<>]/g, '')
            const safeArtists = val.track.artists
                .map((x) => x.name)
                .join(', ')
                .replace(/[?"/\\*:\|<>]/g, '')

            const defaultSavePath = path.join(
                downloadDir,
                `${safeTitle} - ${safeArtists}.${fileExtension}`,
            )
            dialog
                .showSaveDialog(mainWindow, {
                    title: 'Сохранить трек',
                    defaultPath: defaultSavePath,
                    filters: [{ name: 'Трек', extensions: [fileExtension] }],
                })
                .then((result) => {
                    if (!result.canceled) {
                        const filePath = result.filePath
                        console.log(val.track.downloadInfo?.transport)
                        if (val.track.downloadInfo?.transport === 'encraw') {
                            https
                                .get(val.url, (response) => {
                                    const chunks: Buffer[] = []
                                    let downloadedBytes = 0
                                    const totalFileSize = parseInt(
                                        response.headers['content-length'] as string,
                                        10,
                                    )
                                    response.on('data', (chunk) => {
                                        chunks.push(chunk)
                                        downloadedBytes += chunk.length
                                        const percent = getPercent(
                                            downloadedBytes,
                                            totalFileSize,
                                        )
                                        mainWindow.setProgressBar(percent / 100)
                                        if (percent <= 98) {
                                            mainWindow.webContents.send(
                                                'download-track-progress',
                                                percent,
                                            )
                                        }
                                    })

                                    response.on('end', async () => {
                                        try {
                                            const encryptedBuffer =
                                                Buffer.concat(chunks)
                                            const arrayBuffer =
                                                encryptedBuffer.buffer.slice(
                                                    encryptedBuffer.byteOffset,
                                                    encryptedBuffer.byteOffset +
                                                        encryptedBuffer.byteLength,
                                                )
                                            const decryptedArrayBuffer =
                                                await decryptData({
                                                    key: val.track.downloadInfo.key,
                                                    data: arrayBuffer,
                                                })
                                            const decryptedBuffer =
                                                Buffer.from(decryptedArrayBuffer)
                                            fs.writeFileSync(
                                                filePath,
                                                decryptedBuffer,
                                            )

                                            if (val.metadata) {
                                                const extension = path
                                                    .extname(filePath)
                                                    .toLowerCase()
                                                if (
                                                    [
                                                        '.flac',
                                                        '.aac',
                                                        '.aac256',
                                                        '.aac128',
                                                        '.aac64g',
                                                        '.aac64he',
                                                    ].includes(extension)
                                                ) {
                                                    const mp3Path = filePath.replace(
                                                        extension,
                                                        '.mp3',
                                                    )
                                                    try {
                                                        await convertToMP3(
                                                            filePath,
                                                            mp3Path,
                                                        )
                                                        fs.unlinkSync(filePath)
                                                        mainWindow.webContents.send(
                                                            'download-track-progress',
                                                            100,
                                                        )
                                                        await writeMetadata(
                                                            mp3Path,
                                                            val.track,
                                                        )
                                                        setTimeout(() => {
                                                            mainWindow.webContents.send(
                                                                'download-track-finished',
                                                            )
                                                        }, 1500)
                                                        shell.showItemInFolder(
                                                            mp3Path,
                                                        )
                                                    } catch (err) {
                                                        logger.main.error(
                                                            'Ошибка конвертации в mp3:',
                                                            err,
                                                        )
                                                        mainWindow.webContents.send(
                                                            'download-track-failed',
                                                        )
                                                    }
                                                } else {
                                                    await writeMetadata(
                                                        filePath,
                                                        val.track,
                                                    )
                                                    mainWindow.webContents.send(
                                                        'download-track-finished',
                                                    )
                                                    shell.showItemInFolder(filePath)
                                                }
                                            }
                                            mainWindow.webContents.send(
                                                'download-track-progress',
                                                100,
                                            )
                                            setTimeout(() => {
                                                mainWindow.webContents.send(
                                                    'download-track-finished',
                                                )
                                            }, 1500)
                                            shell.showItemInFolder(filePath)
                                            mainWindow.setProgressBar(-1)
                                        } catch (err) {
                                            logger.main.error(
                                                'Error while decrypting or saving the file:',
                                                err,
                                            )
                                            mainWindow.webContents.send(
                                                'download-track-failed',
                                            )
                                        }
                                    })
                                })
                                .on('error', (err) => {
                                    logger.main.error(
                                        'Error while downloading:',
                                        err,
                                    )
                                    mainWindow.webContents.send(
                                        'download-track-failed',
                                    )
                                })
                        } else {
                            https
                                .get(val.url, (response) => {
                                    const totalFileSize = parseInt(
                                        response.headers['content-length'] as string,
                                        10,
                                    )
                                    let downloadedBytes = 0
                                    response.on('data', (chunk) => {
                                        downloadedBytes += chunk.length
                                        const percent = getPercent(
                                            downloadedBytes,
                                            totalFileSize,
                                        )
                                        mainWindow.setProgressBar(percent / 100)
                                        if (percent <= 98) {
                                            mainWindow.webContents.send(
                                                'download-track-progress',
                                                percent,
                                            )
                                        }
                                    })

                                    const fileStream = fs.createWriteStream(filePath)
                                    response
                                        .pipe(fileStream)
                                        .on('finish', async () => {
                                            if (val.metadata) {
                                                const extension = path
                                                    .extname(filePath)
                                                    .toLowerCase()
                                                if (
                                                    [
                                                        '.flac',
                                                        '.aac',
                                                        '.aac256',
                                                        '.aac128',
                                                        '.aac64g',
                                                        '.aac64he',
                                                    ].includes(extension)
                                                ) {
                                                    const mp3Path = filePath.replace(
                                                        extension,
                                                        '.mp3',
                                                    )
                                                    try {
                                                        await convertToMP3(
                                                            filePath,
                                                            mp3Path,
                                                        )
                                                        fs.unlinkSync(filePath)
                                                        mainWindow.webContents.send(
                                                            'download-track-progress',
                                                            100,
                                                        )
                                                        await writeMetadata(
                                                            mp3Path,
                                                            val.track,
                                                        )
                                                        setTimeout(() => {
                                                            mainWindow.webContents.send(
                                                                'download-track-finished',
                                                            )
                                                        }, 1500)
                                                        shell.showItemInFolder(
                                                            mp3Path,
                                                        )
                                                    } catch (err) {
                                                        logger.main.error(
                                                            'Ошибка конвертации в mp3:',
                                                            err,
                                                        )
                                                        mainWindow.webContents.send(
                                                            'download-track-failed',
                                                        )
                                                    }
                                                } else {
                                                    await writeMetadata(
                                                        filePath,
                                                        val.track,
                                                    )
                                                    mainWindow.webContents.send(
                                                        'download-track-finished',
                                                    )
                                                    shell.showItemInFolder(filePath)
                                                }
                                            }
                                            mainWindow.webContents.send(
                                                'download-track-progress',
                                                100,
                                            )
                                            setTimeout(() => {
                                                mainWindow.webContents.send(
                                                    'download-track-finished',
                                                )
                                            }, 1500)
                                            shell.showItemInFolder(filePath)
                                            mainWindow.setProgressBar(-1)
                                        })
                                })
                                .on('error', () => {
                                    mainWindow.webContents.send(
                                        'download-track-failed',
                                    )
                                })
                        }
                    } else {
                        mainWindow.webContents.send('download-track-cancelled')
                    }
                })
                .catch(() => mainWindow.webContents.send('download-track-failed'))
        },
    )

    function convertToMP3(
        inputFilePath: string,
        outputFilePath: string,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputFilePath)
                .audioCodec('libmp3lame')
                .audioBitrate(320)
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(outputFilePath)
        })
    }

    async function writeMetadata(filePath: string, track: Track): Promise<void> {
        let coverRes, coverBuffer
        if (track?.coverUri) {
            coverRes = await fetch(
                'https://' + track?.coverUri.replace('%%', '1000x1000'),
            )
            coverBuffer = Buffer.from(await coverRes.arrayBuffer())
        }

        const tags: Tags = {
            title: track.title,
            artist:
                track.artists.map((artist) => artist.name).join(', ') ||
                'Unknown Artist',
            album: track.albums[0]?.title || 'Unknown Album',
            year: track.albums[0]?.year.toString(),
            genre: track.albums[0]?.genre || 'Unknown',
            APIC: coverBuffer,
        }

        const success = NodeID3.write(tags, filePath)
        if (success) {
            logger.main.info('Metadata successfully written.')
        } else {
            throw new Error('Error writing metadata.')
        }
    }
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
    ipcMain.handle('needModalUpdate', async (event) => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        } else return false
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

    ipcMain.handle('checkSleepMode', async (event, data) => {
        return inSleepMode
    })

    ipcMain.handle('create-new-extension', async (event, args) => {
        try {
            console.log('test')
            const defaultTheme = {
                name: 'New Extension',
                image: 'url',
                author: 'Your Name',
                description: 'Default theme.',
                version: '1.0.0',
                css: 'style.css',
                script: 'script.js',
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
                defaultTheme.name = newName
            }

            const extensionPath = path.join(extensionsPath, newName)
            fs.mkdirSync(extensionPath)
            fs.writeFileSync(
                path.join(extensionPath, 'metadata.json'),
                JSON.stringify(defaultTheme, null, 2),
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
    ipcMain.handle('exportTheme', async (event, data) => {
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
