import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import * as path from 'path'
import * as https from 'https'
import axios from 'axios'
import crypto from 'crypto'
import { promisify } from 'util'
import * as zlib from 'node:zlib'
import * as fs from 'original-fs'

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
    getYandexMusicVersion,
    updateIntegrityHashInExe,
    isWindows,
} from '../../utils/appUtils'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { deleteFfmpeg, installFfmpeg } from '../../utils/ffmpeg-installer'
import { mainWindow } from '../createWindow'
import { getState } from '../state'
import asar from '@electron/asar'

const TEMP_DIR = app.getPath('temp')
const gunzipAsync = promisify(zlib.gunzip)
const zstdDecompressAsync = promisify(zlib.zstdDecompress)
const State = getState()

const paths = {
    music: '' as string,
    defaultAsar: '' as string,
    modAsar: '' as string,
    backupAsar: '' as string,
}
const versions = {
    yandexMusic: '' as string,
    mod: '' as string,
    modName: '' as string,
}

async function initializePaths(): Promise<void> {
    try {
        paths.music = await getPathToYandexMusic()
        paths.defaultAsar = path.join(paths.music, 'app.asar')
        paths.modAsar = (State.get('settings.modSavePath') as string) || paths.defaultAsar
        paths.backupAsar = paths.modAsar.replace(/\.asar$/, '.backup.asar')
    } catch (err) {
        logger.modManager.error('Ошибка при получении пути:', err)
    }
}

function sendFailure(
    channel: 'download-failure' | 'remove-mod-failure',
    params: { error: string; type?: string; url?: string; requiredVersion?: string; recommendedVersion?: string },
) {
    mainWindow?.webContents.send(channel, { success: false, ...params })
    mainWindow.setProgressBar(-1)
}

async function closeMusicIfRunning(): Promise<void> {
    if (await isYandexMusicRunning()) {
        mainWindow.webContents.send(RendererEvents.UPDATE_MESSAGE, { message: 'Закрытие Яндекс Музыки...' })
        await closeYandexMusic()
        await new Promise(r => setTimeout(r, 500))
    }
}

async function ensureBackup(): Promise<void> {
    if (!fs.existsSync(paths.backupAsar)) {
        let source: string | null = null
        if (fs.existsSync(paths.modAsar)) source = paths.modAsar
        else if (fs.existsSync(paths.defaultAsar)) source = paths.defaultAsar

        if (!source) {
            sendFailure(RendererEvents.DOWNLOAD_FAILURE, {
                error: `${path.basename(paths.modAsar)} не найден. Пожалуйста, переустановите Яндекс Музыку.`,
                type: 'file_not_found',
            })
            await downloadYandexMusic('reinstall')
            throw new Error('file_not_found')
        }

        fs.copyFileSync(source, paths.backupAsar)
        logger.modManager.info(`Создана резервная копия ${path.basename(source)} → ${path.basename(paths.backupAsar)}`)
    } else {
        logger.modManager.info(`Резервная копия уже существует: ${path.basename(paths.backupAsar)}`)
    }
}

async function restoreWindowsIntegrity(): Promise<void> {
    try {
        const exePath = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic', 'Яндекс Музыка.exe')
        const newHash = crypto.createHash('sha256').update(asar.getRawHeader(paths.modAsar).headerString).digest('hex')
        await updateIntegrityHashInExe(exePath, newHash)
        logger.modManager.info('Windows Integrity hash восстановлен.')
    } catch (err) {
        logger.modManager.error('Ошибка восстановления Integrity hash в exe:', err)
    }
}

async function restoreMacIntegrity(): Promise<void> {
    try {
        const appBundlePath = path.resolve(path.dirname(paths.modAsar), '..', '..')
        const patcher = new AsarPatcher(appBundlePath)
        await patcher.patch((p, msg) => {
            logger.modManager.info(`restore-mac: ${msg} (${p})`)
        })
        logger.modManager.info('macOS Integrity hash восстановлен.')
    } catch (err) {
        logger.modManager.error('Ошибка восстановления Integrity hash в Info.plist:', err)
    }
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
        const resp = await axios.get(`${config.SERVER_URL}/api/v1/mod/v2/check`, {
            params: { yandexVersion: ymV, modVersion: modV },
        })
        const d = resp.data
        if (d.error) return { success: false, message: d.error }
        return {
            success: d.success ?? false,
            message: d.message,
            code: d.code,
            url: d.url,
            requiredVersion: d.requiredVersion,
            recommendedVersion: d.recommendedVersion || modV,
        }
    } catch (err) {
        logger.modManager.error('Ошибка при проверке совместимости мода:', err)
        return { success: false, message: 'Произошла ошибка при проверке совместимости мода.' }
    }
}

const downloadAndUpdateFile = async (link: string, tempFilePath: string, savePath: string, event: any, checksum?: string) => {
    const phaseWeight = { download: 0.6, patch: 0.4 }
    let downloadFrac = 0
    let patchFrac = 0
    let isFinished = false
    let isError = false

    const sendUnifiedProgress = () => {
        const overall = downloadFrac * phaseWeight.download + patchFrac * phaseWeight.patch
        mainWindow?.setProgressBar(overall)
        mainWindow?.webContents.send(RendererEvents.DOWNLOAD_PROGRESS, { progress: Math.round(overall * 100) })
    }

    try {
        if (checksum && fs.existsSync(savePath)) {
            const buf = fs.readFileSync(savePath)
            const currentHash = crypto.createHash('sha256').update(buf).digest('hex')
            if (currentHash === checksum) {
                logger.modManager.info('app.asar совпадает с checksum, пропускаем загрузку')
                State.set('mod', {
                    version: versions.mod,
                    musicVersion: versions.yandexMusic,
                    name: versions.modName,
                })
                mainWindow.webContents.send(RendererEvents.DOWNLOAD_SUCCESS, { success: true, message: 'Мод уже установлен.' })
                return
            }
        }

        const httpsAgent = new https.Agent({ rejectUnauthorized: false })
        const response = await axios.get(link, { httpsAgent, responseType: 'stream' })
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
            if (!isFinished) {
                isFinished = true
                writer.end()
            }
        })

        response.data.on('error', (err: Error) => {
            if (isFinished) return
            isFinished = true
            isError = true
            writer.end()
            fs.unlink(tempFilePath, () => {})
            if (fs.existsSync(paths.backupAsar)) fs.renameSync(paths.backupAsar, savePath)
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'responseData', 'on error', err)
            logger.http.error('Download error:', err.message)
            sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: 'Ошибка при скачивании. Проверьте интернет.', type: 'download_error' })
        })

        writer.on('finish', async () => {
            if (!isFinished || isError) return
            mainWindow.setProgressBar(-1)

            try {
                const fileBuffer = fs.readFileSync(tempFilePath)

                let asarBuf: Buffer<ArrayBufferLike> = fileBuffer
                const ext = path.extname(new URL(link).pathname).toLowerCase()
                if (ext === '.gz') asarBuf = await gunzipAsync(fileBuffer)
                else if (ext === '.zst' || ext === '.zstd') asarBuf = await zstdDecompressAsync(fileBuffer)

                if (checksum) {
                    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
                    if (hash !== checksum) {
                        fs.unlinkSync(tempFilePath)
                        return sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: 'Ошибка целостности файла.', type: 'checksum_mismatch' })
                    }
                }

                fs.writeFileSync(savePath, asarBuf)
                fs.unlinkSync(tempFilePath)
                const patcher = new AsarPatcher(path.resolve(path.dirname(savePath), '..', '..'))
                const ok = await patcher.patch((p, status) => {
                    patchFrac = Math.min(p / 100, 1)
                    sendUnifiedProgress()
                    logger.modManager.info(`patch status: ${status}, progress: ${p}`)
                })
                if (!ok) {
                    if (fs.existsSync(paths.backupAsar)) fs.renameSync(paths.backupAsar, savePath)
                    return sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: 'Ошибка при патчинге ASAR', type: 'patch_error' })
                }

                State.set('mod', {
                    version: versions.mod,
                    musicVersion: versions.yandexMusic,
                    name: versions.modName,
                    installed: true,
                })
                await installFfmpeg(mainWindow)
                mainWindow.setProgressBar(-1)
                setTimeout(() => mainWindow.webContents.send(RendererEvents.DOWNLOAD_SUCCESS, { success: true }), 1500)
            } catch (e: any) {
                fs.unlink(tempFilePath, () => {})
                if (fs.existsSync(paths.backupAsar)) fs.renameSync(paths.backupAsar, savePath)
                logger.modManager.error('Error processing downloaded file:', e)
                HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.finish', 'try-catch', e)
                sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: e.message, type: 'finish_error' })
            }
        })

        writer.on('error', (err: Error) => {
            fs.unlink(tempFilePath, () => {})
            logger.modManager.error('Error writing file:', err)
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.error', 'on error', err)
            sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: err.message, type: 'writer_error' })
        })
    } catch (err: any) {
        fs.unlink(tempFilePath, () => {})
        logger.modManager.error('Error downloading file:', err)
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'axios.get', 'outer catch', err)
        sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: err.message, type: 'download_outer_error' })
    }
}

export const modManager = (window: BrowserWindow): void => {
    initializePaths()

    ipcMain.on(MainEvents.UPDATE_MUSIC_ASAR, async (event, { version, name, link, checksum, shouldReinstall, force, spoof }) => {
        try {
            if (shouldReinstall && !State.get('settings.musicReinstalled') && isWindows()) {
                State.set('settings', { musicReinstalled: true })
                return await downloadYandexMusic('reinstall')
            }

            await initializePaths()

            if (isLinux()) {
                const defaultExists = fs.existsSync(paths.defaultAsar)
                if (!defaultExists && !State.get('settings.modSavePath')) {
                    const { response } = await dialog.showMessageBox({
                        type: 'info',
                        title: 'Укажите путь к модификации ASAR',
                        message: 'Куда сохранить модификацию ASAR для Яндекс Музыки?',
                        buttons: ['Указать файл', 'Отменить'],
                    })
                    if (response === 0) {
                        const fileRes = await dialog.showSaveDialog({
                            title: 'Сохранить модификацию ASAR как...',
                            defaultPath: path.join(paths.music, 'app.asar'),
                            filters: [{ name: 'ASAR Files', extensions: ['asar'] }],
                        })
                        if (fileRes.canceled || !fileRes.filePath) {
                            return sendFailure(RendererEvents.DOWNLOAD_FAILURE, {
                                error: 'Не указан путь для сохранения модификации ASAR.',
                                type: 'mod_save_path_missing',
                            })
                        }
                        paths.modAsar = fileRes.filePath
                        State.set('settings', { modSavePath: paths.modAsar })
                        paths.backupAsar = paths.modAsar.replace(/\.asar$/, '.backup.asar')
                    } else {
                        return sendFailure(RendererEvents.DOWNLOAD_FAILURE, {
                            error: 'Не указан путь для сохранения модификации ASAR.',
                            type: 'mod_save_path_missing',
                        })
                    }
                } else {
                    if (!State.get('settings.modSavePath')) {
                        paths.modAsar = paths.defaultAsar
                        paths.backupAsar = paths.modAsar.replace(/\.asar$/, '.backup.asar')
                    } else {
                        paths.modAsar = State.get('settings.modSavePath') as string
                        paths.backupAsar = paths.modAsar.replace(/\.asar$/, '.backup.asar')
                    }
                }
            }

            await closeMusicIfRunning()

            versions.yandexMusic = await getYandexMusicVersion()
            versions.mod = version
            versions.modName = name
            logger.modManager.info(`Текущая версия Яндекс Музыки: ${versions.yandexMusic}`)

            if (!force && !spoof) {
                const comp = await checkModCompatibility(version, versions.yandexMusic)
                if (!comp.success) {
                    const type =
                        comp.code === 'YANDEX_VERSION_OUTDATED'
                            ? 'version_outdated'
                            : comp.code === 'YANDEX_VERSION_TOO_NEW'
                              ? 'version_too_new'
                              : 'unknown'
                    return sendFailure(RendererEvents.DOWNLOAD_FAILURE, {
                        error: comp.message || 'Мод не совместим с текущей версией Яндекс Музыки.',
                        type,
                        url: comp.url,
                        requiredVersion: comp.requiredVersion,
                        recommendedVersion: comp.recommendedVersion,
                    })
                }
            }

            await ensureBackup()

            if (isMac()) {
                try {
                    await copyFile(paths.modAsar, paths.modAsar)
                } catch (e) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles')
                    return sendFailure(RendererEvents.DOWNLOAD_FAILURE, {
                        error: 'Пожалуйста, предоставьте приложению полный доступ к диску.',
                        type: 'file_copy_error',
                    })
                }
            }

            const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')
            await downloadAndUpdateFile(link, tempFilePath, paths.modAsar, event, checksum)
        } catch (error: any) {
            logger.modManager.error('Unexpected error:', error)
            HandleErrorsElectron.handleError('modManager', MainEvents.UPDATE_MUSIC_ASAR, 'handler', error)
            sendFailure(RendererEvents.DOWNLOAD_FAILURE, { error: error.message, type: 'unexpected_error' })
        }
    })

    ipcMain.on(MainEvents.REMOVE_MOD, async () => {
        try {
            const doRemove = async () => {
                if (fs.existsSync(paths.backupAsar)) {
                    fs.renameSync(paths.backupAsar, paths.modAsar)
                    logger.modManager.info('Резервная копия восстановлена.')
                } else {
                    return await downloadYandexMusic('reinstall')
                }

                if (isWindows()) await restoreWindowsIntegrity()
                else if (isMac()) await restoreMacIntegrity()

                State.delete('mod.version')
                State.delete('mod.musicVersion')
                State.delete('mod.name')
                State.set('mod.installed', false)
                await deleteFfmpeg()
                mainWindow.webContents.send(RendererEvents.REMOVE_MOD_SUCCESS, { success: true })
            }

            await closeMusicIfRunning()
            await doRemove()
        } catch (error: any) {
            logger.modManager.error('Error removing mod:', error)
            HandleErrorsElectron.handleError('modManager', MainEvents.REMOVE_MOD, 'handler', error)
            sendFailure(RendererEvents.REMOVE_MOD_FAILURE, { error: error.message, type: 'remove_mod_error' })
        }
    })
}
