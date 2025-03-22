import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron'
import * as path from 'path'
import * as https from 'https'
import { store } from '../storage'
import { mainWindow } from '../../../index'
import axios from 'axios'
import crypto from 'crypto'
import { getPathToYandexMusic, isYandexMusicRunning, closeYandexMusic, isLinux } from '../../utils/appUtils'
import logger from '../logger'
import config from '../../../renderer/api/config'
import * as fs from 'original-fs'
import * as Sentry from '@sentry/electron/main'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'

let yandexMusicVersion: string = null
let modVersion: string = null
const musicPath = getPathToYandexMusic()
let asarBackupFilename = 'app.backup.asar'
let modFilename = 'app.asar'
let savePath = path.join(musicPath, modFilename)

if (isLinux() && store.has('settings.modFilename')) {
    modFilename = store.get('settings.modFilename')
    asarBackupFilename = modFilename
    savePath = path.join(musicPath, modFilename)
}

const backupPath = path.join(musicPath, asarBackupFilename)

function sendDownloadFailure(params: { error: string; type?: string; url?: string; requiredVersion?: string; recommendedVersion?: string }) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('download-failure', {
            success: false,
            ...params,
        })
    }
}

function sendRemoveModFailure(params: { error: string; type?: string }) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('remove-mod-failure', {
            success: false,
            ...params,
        })
    }
}

export const handleModEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-app-asar', async (event, { version, link, checksum, force, spoof }) => {
        try {
            if (!store.has('settings.modFilename') && isLinux()) {
                dialog
                    .showMessageBox({
                        type: 'info',
                        title: 'Укажите имя модификации.',
                        message: 'Пожалуйста, укажите имя файла модификации asar в зависимости от клиента Яндекс Музыки.',
                        buttons: ['Указать имя', 'Отменить'],
                    })
                    .then(result => {
                        if (result.response === 0) {
                            dialog
                                .showOpenDialog({
                                    properties: ['openDirectory'],
                                })
                                .then(folderResult => {
                                    if (!folderResult.canceled && folderResult.filePaths && folderResult.filePaths[0]) {
                                        store.set('settings.modFilename', folderResult.filePaths[0])
                                    } else {
                                        sendDownloadFailure({
                                            error: 'Не указано имя файла модификации asar. Попробуйте снова.',
                                            type: 'mod_filename_missing',
                                        })
                                        return
                                    }
                                })
                        } else {
                            sendDownloadFailure({
                                error: 'Не указано имя файла модификации asar.',
                                type: 'mod_filename_missing',
                            })
                            return
                        }
                    })
            }
            const isRunning = await isYandexMusicRunning()
            if (isRunning) {
                mainWindow.webContents.send('update-message', {
                    message: 'Закрытие Яндекс Музыки...',
                })
                await closeYandexMusic()
            }

            yandexMusicVersion = await getYandexMusicVersion()
            modVersion = version
            logger.main.info(`Current Yandex Music version: ${yandexMusicVersion}`)

            if (!force && !spoof) {
                try {
                    const compatibilityResult = await checkModCompatibility(version, yandexMusicVersion)

                    if (!compatibilityResult.success) {
                        const failureType =
                            compatibilityResult.code === 'YANDEX_VERSION_OUTDATED'
                                ? 'version_outdated'
                                : compatibilityResult.code === 'YANDEX_VERSION_TOO_NEW'
                                  ? 'version_too_new'
                                  : 'unknown'

                        sendDownloadFailure({
                            error: compatibilityResult.message || 'Этот мод не совместим с текущей версией Яндекс Музыки.',
                            type: failureType,
                            url: compatibilityResult.url,
                            requiredVersion: compatibilityResult.requiredVersion,
                            recommendedVersion: compatibilityResult.recommendedVersion,
                        })
                        return
                    }
                } catch (error) {
                    sendDownloadFailure({
                        error: `Ошибка при проверке совместимости мода: ${error.message}`,
                        type: 'compatibility_check_error',
                    })
                    return
                }
            }

            if (!fs.existsSync(backupPath)) {
                if (fs.existsSync(savePath)) {
                    fs.copyFileSync(savePath, backupPath)
                    logger.main.info('Original app.asar saved as app.backup.asar')
                } else {
                    sendDownloadFailure({
                        error: `Файл app.asar не найден. Пожалуйста, переустановите Яндекс Музыку.`,
                        type: 'file_not_found',
                    })
                    return
                }
            } else {
                logger.main.info('Backup app.backup.asar already exists')
            }

            const tempFilePath = path.join(app.getPath('temp'), 'app.asar.download')

            await downloadAndUpdateFile(link, tempFilePath, savePath, event, checksum)
        } catch (error: any) {
            logger.main.error('Unexpected error:', error)
            HandleErrorsElectron.handleError('modManager', 'update-app-asar', 'try-catch', error)
            if (mainWindow) {
                mainWindow.setProgressBar(-1)
            }
            sendDownloadFailure({
                error: error.message,
                type: 'unexpected_error',
            })
        }
    })

    ipcMain.on('remove-mod', async event => {
        try {
            const removeMod = () => {
                if (fs.existsSync(backupPath)) {
                    fs.renameSync(backupPath, savePath)
                    logger.main.info('Backup app.asar restored.')

                    store.delete('mod.version')
                    store.delete('mod.musicVersion')
                    store.set('mod.installed', false)

                    mainWindow.webContents.send('remove-mod-success', {
                        success: true,
                    })
                } else {
                    sendRemoveModFailure({
                        error: 'Резервная копия не найдена. Переустановите Яндекс Музыку',
                        type: 'backup_not_found',
                    })
                }
            }
            const isRunning = await isYandexMusicRunning()
            if (isRunning) {
                mainWindow.webContents.send('update-message', {
                    message: 'Закрытие Яндекс Музыки...',
                })
                await closeYandexMusic()
                setTimeout(() => removeMod(), 1500)
            }
        } catch (error) {
            logger.main.error('Error removing mod:', error)
            HandleErrorsElectron.handleError('modManager', 'remove-mod', 'remove-mod', error)
            sendRemoveModFailure({
                error: error.message,
                type: 'remove_mod_error',
            })
        }
    })
}

const getYandexMusicVersion = async (): Promise<string> => {
    const configFilePath = path.join(process.env.APPDATA || '', 'YandexMusic', 'config.json')

    try {
        if (fs.existsSync(configFilePath)) {
            const configData = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))

            if (configData && configData.version) {
                return configData.version
            } else {
                throw new Error('Версия не найдена в файле config.json')
            }
        } else {
            throw new Error('Файл config.json не найден')
        }
    } catch (error) {
        throw new Error(`Не удалось получить версию Яндекс Музыки из config.json: ${error.message}`)
    }
}

const checkModCompatibility = async (
    modVersion: string,
    yandexMusicVersion: string,
): Promise<{
    success: boolean
    message?: string
    code?: string
    url?: string
    requiredVersion?: string
    recommendedVersion?: string
}> => {
    try {
        const response = await axios.get(`${config.SERVER_URL}/api/v1/mod/v2/check`, {
            params: {
                yandexVersion: yandexMusicVersion,
                modVersion: modVersion,
            },
        })
        const data = response.data

        if (data.error) {
            return {
                success: false,
                message: data.error,
            }
        }
        return {
            success: data.success || false,
            message: data.message,
            code: data.code,
            url: data.url,
            requiredVersion: data.requiredVersion,
            recommendedVersion: data.recommendedVersion || modVersion,
        }
    } catch (error) {
        logger.main.error('Ошибка при проверке совместимости мода:', error)

        return {
            success: false,
            message: 'Произошла ошибка при проверке совместимости мода.',
        }
    }
}

const downloadAndUpdateFile = async (link: string, tempFilePath: string, savePath: string, event: any, checksum?: string) => {
    try {
        if (checksum && fs.existsSync(savePath)) {
            const fileBuffer = fs.readFileSync(savePath)
            const hashSum = crypto.createHash('sha256')
            hashSum.update(fileBuffer)
            const currentChecksum = hashSum.digest('hex')

            if (currentChecksum === checksum) {
                logger.main.info('app.asar file already matches the required checksum. Installation complete.')
                mainWindow.webContents.send('download-success', {
                    success: true,
                    message: 'Мод уже установлен.',
                })
                store.set('mod.version', modVersion)
                store.set('mod.installed', true)
                store.set('mod.musicVersion', yandexMusicVersion)
                return
            }
        }

        const httpsAgent = new https.Agent({
            rejectUnauthorized: false,
        })

        const writer = fs.createWriteStream(tempFilePath)
        let isFinished = false
        let isError = false

        const response = await axios.get(link, {
            httpsAgent,
            responseType: 'stream',
        })

        const totalLength = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedLength = 0

        response.data.on('data', (chunk: Buffer) => {
            if (isFinished) return
            downloadedLength += chunk.length
            const progress = downloadedLength / totalLength

            if (mainWindow) {
                mainWindow.setProgressBar(progress)
            }
            if (progress * 100 <= 99) {
                mainWindow.webContents.send('download-progress', {
                    progress: Math.round(progress * 100),
                })
            }
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
                error: 'Произошла ошибка при скачивании. Пожалуйста, проверьте ваше интернет-соединение.',
                type: 'download_error',
            })
            mainWindow.setProgressBar(-1)
        })

        writer.on('finish', async () => {
            try {
                if (!isFinished) return
                if (isError) return
                if (mainWindow) {
                    mainWindow.setProgressBar(-1)
                }

                if (checksum) {
                    const fileBuffer = fs.readFileSync(tempFilePath)
                    const hashSum = crypto.createHash('sha256')
                    hashSum.update(fileBuffer)
                    const hex = hashSum.digest('hex')

                    if (hex !== checksum) {
                        fs.unlinkSync(tempFilePath)
                        logger.main.error('Checksum mismatch')
                        sendDownloadFailure({
                            error: 'Ошибка при проверке целостности файла. Попробуйте скачать еще раз.',
                            type: 'checksum_mismatch',
                        })
                        return
                    }
                }

                fs.renameSync(tempFilePath, savePath)
                store.set('mod.version', modVersion)
                store.set('mod.musicVersion', yandexMusicVersion)
                store.set('mod.installed', true)
                setTimeout(() => {
                    mainWindow.webContents.send('download-success', {
                        success: true,
                    })
                }, 1500)
            } catch (e) {
                fs.unlink(tempFilePath, () => {})
                logger.main.error('Error writing file:', e)
                HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.finish', 'try-catch', e)
                if (mainWindow) {
                    mainWindow.setProgressBar(-1)
                }
                sendDownloadFailure({
                    error: e.message,
                    type: 'finish_error',
                })
            }
        })

        writer.on('error', (err: Error) => {
            fs.unlink(tempFilePath, () => {})
            logger.main.error('Error writing file:', err)
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.error', 'on error', err)
            if (mainWindow) {
                mainWindow.setProgressBar(-1)
            }
            sendDownloadFailure({
                error: err.message,
                type: 'writer_error',
            })
        })
    } catch (err) {
        fs.unlink(tempFilePath, () => {})
        logger.main.error('Error downloading file:', err)
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'axios.get', 'outer catch', err)
        if (mainWindow) {
            mainWindow.setProgressBar(-1)
        }
        sendDownloadFailure({
            error: err.message,
            type: 'download_outer_error',
        })
    }
}

export const handleMod = (window: BrowserWindow): void => {
    handleModEvents(window)
}
