import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as https from 'https'
import axios from 'axios'
import crypto from 'crypto'
import { promisify } from 'util'
import * as zlib from 'zlib'
import * as fs from 'original-fs'
import { exec } from 'child_process'

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
    getYandexMusicAppDataPath,
} from '../../utils/appUtils'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { deleteFfmpeg, installFfmpeg } from '../../utils/ffmpeg-installer'
import { mainWindow } from '../createWindow'
import { getState } from '../state'

const TEMP_DIR = app.getPath('temp')
const gunzipAsync = promisify(zlib.gunzip)
const execAsync = promisify(exec)

let yandexMusicVersion: string = null
let modVersion: string = null
let modName: string = null

const musicPath = getPathToYandexMusic()
const musicAppDataPath = getYandexMusicAppDataPath()
const State = getState()

let modFilenameBase = 'app'
let modFilename = `${modFilenameBase}.asar`
let asarBackupFilename = `${modFilenameBase}.backup.asar`

let asarPath = path.join(musicPath, modFilename)
let backupPath = path.join(musicPath, asarBackupFilename)

if (isLinux() && State.get('settings.modFilename')) {
    const baseName = State.get('settings.modFilename') as string
    modFilenameBase = baseName
    modFilename = `${baseName}.asar`
    asarBackupFilename = `${baseName}.backup.asar`
    asarPath = path.join(musicPath, modFilename)
    backupPath = path.join(musicPath, asarBackupFilename)
}

function sendDownloadFailure(params: { error: string; type?: string; url?: string; requiredVersion?: string; recommendedVersion?: string }) {
    mainWindow?.webContents.send('download-failure', {
        success: false,
        ...params,
    })
    mainWindow.setProgressBar(-1)
}

function sendRemoveModFailure(params: { error: string; type?: string }) {
    mainWindow?.webContents.send('remove-mod-failure', {
        success: false,
        ...params,
    })
}

export const handleModEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-music-asar', async (event, { version, name, link, checksum, force, spoof }) => {
        try {
            if (!State.get('settings.modFilename') && isLinux()) {
                const res = await dialog.showMessageBox({
                    type: 'info',
                    title: 'Укажите имя модификации',
                    message: 'Пожалуйста, укажите имя файла модификации ASAR для клиента Яндекс Музыки.',
                    buttons: ['Указать файл', 'Отменить'],
                })
                if (res.response === 0) {
                    const fileRes = await dialog.showSaveDialog({
                        title: 'Сохранить модификацию ASAR как...',
                        defaultPath: path.join(musicPath, `${modFilenameBase}.mod.asar`),
                        filters: [{ name: 'ASAR Files', extensions: ['asar'] }],
                    })
                    if (fileRes.canceled || !fileRes.filePath) {
                        return sendDownloadFailure({
                            error: 'Не указано имя файла модификации ASAR. Попробуйте снова.',
                            type: 'mod_filename_missing',
                        })
                    }
                    const selectedBase = path.basename(fileRes.filePath, '.asar')
                    State.set('settings.modFilename', selectedBase)
                    modFilenameBase = selectedBase
                    modFilename = `${selectedBase}.asar`
                    asarBackupFilename = `${selectedBase}.backup.asar`
                    asarPath = path.join(musicPath, modFilename)
                    backupPath = path.join(musicPath, asarBackupFilename)
                } else {
                    return sendDownloadFailure({
                        error: 'Не указано имя файла модификации ASAR.',
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
            modName = name
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
                    logger.modManager.info(`Original ${modFilename} saved as ${asarBackupFilename}`)
                } else {
                    sendDownloadFailure({
                        error: `${modFilename} не найден. Пожалуйста, переустановите Яндекс Музыку.`,
                        type: 'file_not_found',
                    })
                    return await downloadYandexMusic('reinstall')
                }
            } else {
                logger.modManager.info(`Backup ${asarBackupFilename} already exists`)
            }

            const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')
            if (isMac()) {
                try {
                    await copyFile(asarPath, asarPath)
                } catch (e) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles')
                    return sendDownloadFailure({
                        error: 'Пожалуйста, предоставьте приложению полный доступ к диску в «Системных настройках» > «Безопасность и конфиденциальность»',
                        type: 'file_copy_error',
                    })
                }
            }
            await downloadAndUpdateFile(link, tempFilePath, asarPath, event, checksum)
        } catch (error: any) {
            logger.modManager.error('Unexpected error:', error)
            HandleErrorsElectron.handleError('modManager', 'update-music-asar', 'try-catch', error)
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
                    logger.modManager.info('Backup restored.')
                    State.delete('mod.version')
                    State.delete('mod.musicVersion')
                    State.delete('mod.name')
                    State.set('mod.installed', false)
                    await deleteFfmpeg()
                    mainWindow.webContents.send('remove-mod-success', {
                        success: true,
                    })
                } else {
                    sendRemoveModFailure({
                        error: 'Резервная копия не найдена. Яндекс Музыка будет переустановлена.',
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
    if (isLinux()) {
        try {
            const { stdout } = await execAsync('dpkg-query -W -f=${Version} yandex-music')
            const version = stdout.trim()
            if (version) {
                return version
            }
        } catch {}

        try {
            const { stdout } = await execAsync('rpm -q --qf "%{VERSION}-%{RELEASE}" yandex-music')
            const version = stdout.trim()
            if (version && !version.startsWith('package yandex-music is not installed')) {
                return version
            }
        } catch {}

        try {
            const { stdout } = await execAsync('pacman -Q yandex-music')
            const parts = stdout.trim().split(/\s+/)
            if (parts.length >= 2) {
                const full = parts[1] 
                const version = full.split('-')[0]
                if (version) {
                    return version
                }
            }
        } catch {}
    }

    const cfgPath = path.join(musicAppDataPath, 'config.json')
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
    const phaseWeight = { download: 0.6, patch: 0.4 }
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
                State.set('mod.version', modVersion)
                State.set('mod.musicVersion', yandexMusicVersion)
                State.set('mod.name', modName)
                mainWindow.webContents.send('download-success', {
                    success: true,
                    message: 'Мод уже установлен.',
                })
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
                State.delete('mod')
            }
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'responseData', 'on error', err)
            logger.http.error('Download error:', err.message)
            sendDownloadFailure({
                error: 'Произошла ошибка при скачивании. Пожалуйста, проверьте интернет-соединение.',
                type: 'download_error',
            })
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
                    const patcher = new AsarPatcher(path.resolve(path.dirname(savePath), '..', '..'))
                    const progressCb = (p: number, status: string) => {
                        logger.modManager.info('status:', status, 'progress:', p)
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

                State.set('mod', {
                    version: modVersion,
                    musicVersion: yandexMusicVersion,
                    name: modName,
                    installed: true,
                })
                await installFfmpeg(mainWindow)
                mainWindow.setProgressBar(-1)
                setTimeout(() => {
                    mainWindow.webContents.send('download-success', {
                        success: true,
                    })
                }, 1500)
            } catch (e: any) {
                fs.unlink(tempFilePath, () => {})
                if (fs.existsSync(backupPath)) {
                    fs.renameSync(backupPath, savePath)
                }
                logger.modManager.error('Error processing downloaded file:', e)
                HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.finish', 'try-catch', e)
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
            sendDownloadFailure({
                error: err.message,
                type: 'writer_error',
            })
        })
    } catch (err: any) {
        fs.unlink(tempFilePath, () => {})
        logger.modManager.error('Error downloading file:', err)
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'axios.get', 'outer catch', err)
        sendDownloadFailure({
            error: err.message,
            type: 'download_outer_error',
        })
    }
}

export const modManager = (window: BrowserWindow): void => {
    handleModEvents(window)
}
