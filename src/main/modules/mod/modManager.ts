import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import * as https from 'https'
import { store } from '../storage'
import { mainWindow } from '../../../index'
import axios from 'axios'
import crypto from 'crypto'
import closeYandexMusic, { isYandexMusicRunning } from '../../utils/appUtils'
import logger from '../logger'
import config from '../../../renderer/api/config'
import * as fs from 'original-fs'
import * as Sentry from '@sentry/electron/main'

let yandexMusicVersion: string = null
let modVersion: string = null
const savePath = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'YandexMusic',
    'resources',
    'app.asar',
)

const backupPath = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs',
    'YandexMusic',
    'resources',
    'app.backup.asar',
)
export const handleModEvents = (window: BrowserWindow): void => {
    ipcMain.on(
        'update-app-asar',
        async (event, { version, link, checksum, force }) => {
            try {
                const isRunning = await isYandexMusicRunning()
                if (isRunning) {
                    event.reply('update-message', {
                        message: 'Закрытие Яндекс Музыки...',
                    })
                    await closeYandexMusic()
                }

                yandexMusicVersion = await getYandexMusicVersion()
                modVersion = version
                logger.main.info(
                    `Current Yandex Music version: ${yandexMusicVersion}`,
                )
                if (!force) {
                    try {
                        const compatible = await checkModCompatibility(
                            version,
                            yandexMusicVersion,
                        )
                        if (!compatible) {
                            event.reply('update-failure', {
                                success: false,
                                error: 'Этот мод не совместим с текущей версией Яндекс Музыки.',
                                type: 'version_mismatch',
                            })
                            return
                        }
                    } catch (error) {
                        event.reply('update-failure', {
                            success: false,
                            error: `Ошибка при проверке совместимости мода: ${error.message}`,
                        })
                        return
                    }
                }

                if (!fs.existsSync(backupPath)) {
                    if (fs.existsSync(savePath)) {
                        fs.copyFileSync(savePath, backupPath)
                        logger.main.info(
                            'Original app.asar saved as app.backup.asar',
                        )
                    } else {
                        throw new Error(
                            'Файл app.asar не найден для создания резервной копии',
                        )
                    }
                } else {
                    logger.main.info('Backup app.backup.asar already exists')
                }

                const tempFilePath = path.join(
                    app.getPath('temp'),
                    'app.asar.download',
                )

                await downloadAndUpdateFile(
                    link,
                    tempFilePath,
                    savePath,
                    event,
                    checksum,
                )
            } catch (error: any) {
                logger.main.error('Unexpected error:', error)
                Sentry.captureException(error)
                if (mainWindow) {
                    mainWindow.setProgressBar(-1)
                }

                event.reply('update-failure', {
                    success: false,
                    error: error.message,
                })
            }
        },
    )

    ipcMain.on('remove-mod', async (event) => {
        try {
            const removeMod = () => {
                if (fs.existsSync(backupPath)) {
                    fs.renameSync(backupPath, savePath)
                    logger.main.info('Backup app.asar restored.')

                    store.delete('mod.version')
                    store.delete('mod.musicVersion')
                    store.set('mod.installed', false)

                    event.reply('remove-mod-success', { success: true })
                } else {
                    event.reply('remove-mod-failure', {
                        success: false,
                        error: 'Резервная копия не найдена. Переустановите Яндекс Музыку',
                    })
                }
            }
            const isRunning = await isYandexMusicRunning()
            if (isRunning) {
                event.reply('update-message', {
                    message: 'Закрытие Яндекс Музыки...',
                })
                await closeYandexMusic()
                setTimeout(() => removeMod(), 1500)
            }
        } catch (error) {
            logger.main.error('Error removing mod:', error)
            Sentry.captureException(error)
            event.reply('remove-mod-failure', {
                success: false,
                error: error.message,
            })
        }
    })
}

const getYandexMusicVersion = async (): Promise<string> => {
    const configFilePath = path.join(
        process.env.APPDATA || '',
        'YandexMusic',
        'config.json',
    )

    try {
        if (fs.existsSync(configFilePath)) {
            const configData = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))

            if (configData && configData.version) {
                return configData.version
            } else {
                throw new Error('Version not found in config.json')
            }
        } else {
            throw new Error('config.json not found')
        }
    } catch (error) {
        throw new Error(
            `Failed to get Yandex Music version from config.json: ${error.message}`,
        )
    }
}

const checkModCompatibility = async (
    modVersion: string,
    yandexMusicVersion: string,
): Promise<boolean> => {
    try {
        const response = await axios.get(
            `${config.SERVER_URL}/api/v1/mod/check?yandexVersion=${yandexMusicVersion}&modVersion=${modVersion}`,
        )

        const data = response.data

        if (data.error && data.statusCode === 404) {
            return false
        }

        return data.compatible || false
    } catch (error) {
        logger.main.error('Error checking mod compatibility:', error)
        return false
    }
}

const downloadAndUpdateFile = async (
    link: string,
    tempFilePath: string,
    savePath: string,
    event: any,
    checksum?: string,
) => {
    try {
        if (checksum && fs.existsSync(savePath)) {
            const fileBuffer = fs.readFileSync(savePath)
            const hashSum = crypto.createHash('sha256')
            hashSum.update(fileBuffer)
            const currentChecksum = hashSum.digest('hex')

            if (currentChecksum === checksum) {
                logger.main.info(
                    'app.asar file already matches the required checksum. Installation complete.',
                )
                event.reply('update-success', {
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

            event.reply('download-progress', {
                progress: Math.round(progress * 100),
            })

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
            Sentry.captureException(err)
            logger.http.error('Download error:', err.message)
            event.reply('update-failure', {
                success: false,
                error: 'Произошла ошибка при скачивании. Пожалуйста, проверьте ваше интернет-соединение.',
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
                        event.reply('update-failure', {
                            success: false,
                            error: 'Checksum не совпадает',
                        })
                        return
                    }
                }

                fs.renameSync(tempFilePath, savePath)
                store.set('mod.version', modVersion)
                store.set('mod.musicVersion', yandexMusicVersion)
                store.set('mod.installed', true)

                event.reply('update-success', { success: true })
            } catch (e) {
                fs.unlink(tempFilePath, () => {})
                logger.main.error('Error writing file:', e)
                Sentry.captureException(e)
                if (mainWindow) {
                    mainWindow.setProgressBar(-1)
                }
                event.reply('update-failure', { success: false, error: e.message })
            }
        })

        writer.on('error', (err: Error) => {
            fs.unlink(tempFilePath, () => {})
            logger.main.error('Error writing file:', err)
            Sentry.captureException(err)
            if (mainWindow) {
                mainWindow.setProgressBar(-1)
            }
            event.reply('update-failure', { success: false, error: err.message })
        })
    } catch (err) {
        fs.unlink(tempFilePath, () => {})
        logger.main.error('Error downloading file:', err)
        Sentry.captureException(err)
        if (mainWindow) {
            mainWindow.setProgressBar(-1)
        }
        event.reply('update-failure', { success: false, error: err.message })
    }
}

export const handleMod = (window: BrowserWindow): void => {
    handleModEvents(window)
}
