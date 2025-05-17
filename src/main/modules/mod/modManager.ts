import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as https from 'https'
import axios from 'axios'
import crypto from 'crypto'
import { promisify } from 'util'
import * as zlib from 'zlib'
import * as fs from 'original-fs'

import { store } from '../storage'
import { mainWindow } from '../../../index'
import logger from '../logger'
import config from '../../../renderer/api/config'
import {
    getPathToYandexMusic,
    isYandexMusicRunning,
    closeYandexMusic,
    isLinux,
    downloadYandexMusic,
    AsarPatcher,
    isMac,
    copyFile,
} from '../../utils/appUtils'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { deleteFfmpeg, installFfmpeg } from '../../utils/ffmpeg-installer'

const TEMP_DIR = app.getPath('temp')

const gunzipAsync = promisify(zlib.gunzip)

let yandexMusicVersion: string = null
let modVersion: string = null

const musicPath = getPathToYandexMusic()
let modFilename = 'app.asar'
let asarBackupFilename = 'app.backup.asar'
let asarPath = path.join(musicPath, modFilename)

if (isLinux() && store.has('settings.modFilename')) {
    modFilename = store.get('settings.modFilename') as string
    asarBackupFilename = modFilename
    asarPath = path.join(musicPath, modFilename)
}

const backupPath = path.join(musicPath, asarBackupFilename)

function sendDownloadFailure(params: { error: string; type?: string; url?: string; requiredVersion?: string; recommendedVersion?: string }) {
    mainWindow?.webContents.send('download-failure', {
        success: false,
        ...params,
    })
}

function sendRemoveModFailure(params: { error: string; type?: string }) {
    mainWindow?.webContents.send('remove-mod-failure', {
        success: false,
        ...params,
    })
}

export const handleModEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-app-asar', async (event, { version, link, checksum, force, spoof }) => {
        try {
            if (!store.has('settings.modFilename') && isLinux()) {
                const res = await dialog.showMessageBox({
                    type: 'info',
                    title: 'Укажите имя модификации',
                    message: 'Пожалуйста, укажите имя файла модификации asar в зависимости от клиента Яндекс Музыки.',
                    buttons: ['Указать имя', 'Отменить'],
                })
                if (res.response === 0) {
                    const folderRes = await dialog.showOpenDialog({
                        properties: ['openDirectory'],
                    })
                    if (folderRes.canceled || !folderRes.filePaths || !folderRes.filePaths[0]) {
                        return sendDownloadFailure({
                            error: 'Не указано имя файла модификации asar. Попробуйте снова.',
                            type: 'mod_filename_missing',
                        })
                    }
                    store.set('settings.modFilename', folderRes.filePaths[0])
                } else {
                    return sendDownloadFailure({
                        error: 'Не указано имя файла модификации asar.',
                        type: 'mod_filename_missing',
                    })
                }
            }

            if (await isYandexMusicRunning()) {
                mainWindow.webContents.send('update-message', {
                    message: 'Закрытие Яндекс Музыки...',
                })
                await closeYandexMusic()
            }

            yandexMusicVersion = await getYandexMusicVersion()
            modVersion = version
            logger.modManager.info(`Current Yandex Music version: ${yandexMusicVersion}`)

            if (!force && !spoof) {
                const comp = await checkModCompatibility(version, yandexMusicVersion)
                if (!comp.success) {
                    const type =
                        comp.code === 'YANDEX_VERSION_OUTDATED'
                            ? 'version_outdated'
                            : comp.code === 'YANDEX_VERSION_TOO_NEW'
                              ? 'version_too_new'
                              : 'unknown'
                    return sendDownloadFailure({
                        error: comp.message || 'Этот мод не совместим с текущей версией Яндекс Музыки.',
                        type,
                        url: comp.url,
                        requiredVersion: comp.requiredVersion,
                        recommendedVersion: comp.recommendedVersion,
                    })
                }
            }

            if (!fs.existsSync(backupPath)) {
                if (fs.existsSync(asarPath)) {
                    fs.copyFileSync(asarPath, backupPath)
                    logger.modManager.info('Original app.asar saved as app.backup.asar')
                } else {
                    sendDownloadFailure({
                        error: 'Файл app.asar не найден. Пожалуйста, переустановите Яндекс Музыку.',
                        type: 'file_not_found',
                    })
                    return await downloadYandexMusic('reinstall')
                }
            } else {
                logger.modManager.info('Backup app.backup.asar already exists')
            }

            const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')
            if (isMac()) {
                try {
                    await copyFile(asarPath, asarPath)
                } catch (e) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles')
                    return sendDownloadFailure({
                        error: 'Пожалуйста, предоставьте приложению управление приложениями или полный доступ к диску в «Системных настройках» > «Безопасность и конфиденциальность»',
                        type: 'file_copy_error',
                    })
                }
            }
            await downloadAndUpdateFile(link, tempFilePath, asarPath, event, checksum)
        } catch (error: any) {
            logger.modManager.error('Unexpected error:', error)
            HandleErrorsElectron.handleError('modManager', 'update-app-asar', 'try-catch', error)
            mainWindow.setProgressBar(-1)
            sendDownloadFailure({
                error: error.message,
                type: 'unexpected_error',
            })
        }
    })

    ipcMain.on('remove-mod', async () => {
        try {
            const doRemove = async () => {
                if (fs.existsSync(backupPath)) {
                    fs.renameSync(backupPath, asarPath)
                    logger.modManager.info('Backup app.asar restored.')
                    store.delete('mod.version')
                    store.delete('mod.musicVersion')
                    store.set('mod.installed', false)
                    await deleteFfmpeg()
                    mainWindow.webContents.send('remove-mod-success', {
                        success: true,
                    })
                } else {
                    sendRemoveModFailure({
                        error: 'Резервная копия не найдена.',
                        type: 'backup_not_found',
                    })
                    await downloadYandexMusic('reinstall')
                }
            }

            if (await isYandexMusicRunning()) {
                mainWindow.webContents.send('update-message', {
                    message: 'Закрытие Яндекс Музыки...',
                })
                await closeYandexMusic()
                setTimeout(doRemove, 1500)
            } else {
                await doRemove()
            }
        } catch (error: any) {
            logger.modManager.error('Error removing mod:', error)
            HandleErrorsElectron.handleError('modManager', 'remove-mod', 'remove-mod', error)
            sendRemoveModFailure({
                error: error.message,
                type: 'remove_mod_error',
            })
        }
    })
}

const getYandexMusicVersion = async (): Promise<string> => {
    const cfgPath = path.join(process.env.APPDATA || '', 'YandexMusic', 'config.json')
    if (!fs.existsSync(cfgPath)) throw new Error('Файл config.json не найден')
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    if (!cfg.version) throw new Error('Версия не найдена в config.json')
    return cfg.version
}

const checkModCompatibility = async (
    modV: string,
    ymV: string,
): Promise<{
    success: boolean
    message?: string
    code?: string
    url?: string
    requiredVersion?: string
    recommendedVersion?: string
}> => {
    try {
        const resp = await axios.get(`${config.SERVER_URL}/api/v1/mod/v2/check`, { params: { yandexVersion: ymV, modVersion: modV } })
        const d = resp.data
        if (d.error) return { success: false, message: d.error }
        return {
            success: d.success || false,
            message: d.message,
            code: d.code,
            url: d.url,
            requiredVersion: d.requiredVersion,
            recommendedVersion: d.recommendedVersion || modV,
        }
    } catch (err) {
        logger.modManager.error('Ошибка при проверке совместимости мода:', err)
        return {
            success: false,
            message: 'Произошла ошибка при проверке совместимости мода.',
        }
    }
}

const downloadAndUpdateFile = async (link: string, tempFilePath: string, savePath: string, event: any, checksum?: string) => {
    const phaseWeight = { download: 0.8, patch: 0.2 }
    let downloadFrac = 0
    let patchFrac = 0

    function sendUnifiedProgress() {
        const overall = downloadFrac * phaseWeight.download + patchFrac * phaseWeight.patch
        mainWindow?.setProgressBar(overall)
        mainWindow?.webContents.send('download-progress', {
            progress: Math.round(overall * 100),
        })
    }

    let isFinished = false
    let isError = false

    try {
        if (checksum && fs.existsSync(savePath)) {
            const buf = fs.readFileSync(savePath)
            const current = crypto.createHash('sha256').update(buf).digest('hex')
            if (current === checksum) {
                logger.modManager.info('app.asar matches checksum, skipping download')
                mainWindow.webContents.send('download-success', {
                    success: true,
                    message: 'Мод уже установлен.',
                })
                store.set('mod.version', modVersion)
                store.set('mod.musicVersion', yandexMusicVersion)
                return
            }
        }

        const httpsAgent = new https.Agent({ rejectUnauthorized: false })
        const response = await axios.get(link, {
            httpsAgent,
            responseType: 'stream',
        })
        const total = parseInt(response.headers['content-length'] || '0', 10)
        let downloaded = 0
        const writer = fs.createWriteStream(tempFilePath)

        response.data.on('data', (chunk: Buffer) => {
            if (isFinished) return
            downloaded += chunk.length
            downloadFrac = Math.min(downloaded / total, 1)
            sendUnifiedProgress()
            writer.write(chunk)
        })

        response.data.on('end', () => {
            if (isFinished) return
            isFinished = true
            writer.end()
        })

        response.data.on('error', (err: Error) => {
            if (isFinished) return
            isFinished = true
            isError = true
            writer.end()
            fs.unlink(tempFilePath, () => {})
            if (fs.existsSync(backupPath)) {
                fs.renameSync(backupPath, savePath)
                store.delete('mod')
            }
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'responseData', 'on error', err)
            logger.http.error('Download error:', err.message)
            sendDownloadFailure({
                error: 'Произошла ошибка при скачивании. Пожалуйста, проверьте интернет-соединение.',
                type: 'download_error',
            })
            mainWindow.setProgressBar(-1)
        })

        writer.on('finish', async () => {
            try {
                if (!isFinished || isError) return
                mainWindow.setProgressBar(-1)

                const compressed = fs.readFileSync(tempFilePath)
                const asarBuf: Buffer = await gunzipAsync(compressed)
                if (checksum) {
                    const hash = crypto.createHash('sha256').update(compressed).digest('hex')
                    if (hash !== checksum) {
                        fs.unlinkSync(tempFilePath)
                        return sendDownloadFailure({
                            error: 'Ошибка при проверке целостности файла.',
                            type: 'checksum_mismatch',
                        })
                    }
                }
                fs.writeFileSync(savePath, asarBuf)
                fs.unlinkSync(tempFilePath)

                if (isMac()) {
                    const patcher = new AsarPatcher(path.resolve(path.dirname(savePath), '..'))
                    const progressCb = (p: number) => {
                        patchFrac = Math.min(p / 100, 1)
                        sendUnifiedProgress()
                    }
                    const ok = await patcher.patch(progressCb)
                    if (!ok) {
                        if (fs.existsSync(backupPath)) {
                            fs.renameSync(backupPath, savePath)
                        }
                        return sendDownloadFailure({
                            error: 'Не удалось пропатчить ASAR',
                            type: 'patch_error',
                        })
                    }
                }

                store.set('mod.version', modVersion)
                store.set('mod.musicVersion', yandexMusicVersion)
                store.set('mod.installed', true)
                await installFfmpeg(mainWindow)
                setTimeout(() => {
                    mainWindow.webContents.send('download-success', { success: true })
                }, 1500)
            } catch (e: any) {
                fs.unlink(tempFilePath, () => {})
                if (fs.existsSync(backupPath)) {
                    fs.renameSync(backupPath, savePath)
                }
                logger.modManager.error('Error processing downloaded file:', e)
                HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.finish', 'try-catch', e)
                mainWindow.setProgressBar(-1)
                sendDownloadFailure({
                    error: e.message,
                    type: 'finish_error',
                })
            }
        })

        writer.on('error', (err: Error) => {
            fs.unlink(tempFilePath, () => {})
            logger.modManager.error('Error writing file:', err)
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.error', 'on error', err)
            mainWindow.setProgressBar(-1)
            sendDownloadFailure({
                error: err.message,
                type: 'writer_error',
            })
        })
    } catch (err: any) {
        fs.unlink(tempFilePath, () => {})
        logger.modManager.error('Error downloading file:', err)
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'axios.get', 'outer catch', err)
        mainWindow.setProgressBar(-1)
        sendDownloadFailure({
            error: err.message,
            type: 'download_outer_error',
        })
    }
}

export const modManager = (window: BrowserWindow): void => {
    handleModEvents(window)
}
