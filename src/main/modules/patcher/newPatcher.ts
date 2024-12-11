import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import * as https from 'https'
import { store } from '../storage'
import { mainWindow } from '../../../index'
import axios from 'axios'
import crypto from 'crypto'
import closeYandexMusic, { isYandexMusicRunning } from '../../utils/appUtils'
import logger from '../logger'
import asar from '@electron/asar'
import config from '../../../renderer/api/config'
import * as fs from 'original-fs'

let yandexMusicVersion: string = null
let modVersion: string = null

export const handlePatcherEvents = (window: BrowserWindow): void => {
    ipcMain.on('update-app-asar', async (event, { version, link, checksum }) => {
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
            logger.main.info(`Текущая версия Яндекс Музыки: ${yandexMusicVersion}`)
            try {
                const compatible = await checkModCompatibility(
                    version,
                    yandexMusicVersion,
                )
                if (!compatible) {
                    event.reply('update-failure', {
                        success: false,
                        error: 'Этот мод не совместим с текущей версией Яндекс Музыки.',
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
            console.log('Path to app.asar:', savePath)

            if (fs.existsSync(savePath) && !fs.existsSync(backupPath)) {
                fs.copyFileSync(savePath, backupPath)
                logger.main.info('Старый app.asar был сохранён как app.backup.asar')
            }

            const tempFilePath = path.join(app.getPath('temp'), 'app.asar.download')

            await downloadAndUpdateFile(
                link,
                tempFilePath,
                savePath,
                event,
                checksum,
            )
        } catch (error: any) {
            logger.main.error('Неожиданная ошибка:', error)

            if (mainWindow) {
                mainWindow.setProgressBar(-1)
            }

            event.reply('update-failure', { success: false, error: error.message })
        }
    })

    ipcMain.on('remove-mod', async (event) => {
        try {
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

            if (fs.existsSync(backupPath)) {
                fs.renameSync(backupPath, savePath)
                logger.main.info('Резервная копия app.asar восстановлена.')

                store.delete('patcher.version')
                store.delete('patcher.musicVersion')
                store.set('patcher.patched', false)

                event.reply('remove-mod-success', { success: true })
            } else {
                event.reply('remove-mod-failure', {
                    success: false,
                    error: 'Резервная копия не найдена.',
                })
            }
        } catch (error) {
            logger.main.error('Ошибка при удалении мода:', error)
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
            throw new Error('config.json не найден')
        }
    } catch (error) {
        throw new Error(
            `Не удалось получить версию Яндекс Музыки из config.json: ${error.message}`,
        )
    }
}

const checkModCompatibility = async (
    modVersion: string,
    yandexMusicVersion: string,
): Promise<boolean> => {
    try {
        const response = await axios.get(
            `${config.SERVER_URL}/api/v1/patcher/check?yandexVersion=${yandexMusicVersion}&modVersion=${modVersion}`,
        )

        const data = response.data

        if (data.error && data.statusCode === 404) {
            return false
        }

        return data.compatible || false
    } catch (error) {
        logger.main.error('Ошибка при проверке совместимости мода:', error)
        return false
    }
}
const isFileLocked = (filePath: string): boolean => {
    try {
        const fd = fs.openSync(filePath, 'r')
        fs.closeSync(fd)
        return false
    } catch (err) {
        return true
    }
}

const downloadAndUpdateFile = async (
    link: string,
    tempFilePath: string,
    savePath: string,
    event: any,
    checksum?: string,
) => {
    const httpsAgent = new https.Agent({
        rejectUnauthorized: false,
    })

    const writer = fs.createWriteStream(tempFilePath)

    let isFinished = false

    try {
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

        writer.on('finish', async () => {
            if (!isFinished) return

            if (mainWindow) {
                mainWindow.setProgressBar(-1)
            }

            if (checksum) {
                const fileBuffer = fs.readFileSync(tempFilePath)
                const hashSum = crypto.createHash('sha256')
                hashSum.update(fileBuffer)
                const hex = hashSum.digest('hex')

                if (hex !== checksum) {
                    fs.unlink(tempFilePath, () => {})
                    logger.main.error('Checksum не совпадает')
                    event.reply('update-failure', {
                        success: false,
                        error: 'Checksum не совпадает',
                    })
                    return
                }
            }

            try {
                fs.renameSync(tempFilePath, savePath)
                store.set('patcher.version', modVersion)
                store.set('patcher.musicVersion', yandexMusicVersion)
                store.set('patcher.patched', true)

                event.reply('update-success', { success: true })
            } catch (err) {
                logger.main.error('Ошибка при перемещении файла:', err)
                event.reply('update-failure', { success: false, error: err.message })
            }
        })

        writer.on('error', (err: Error) => {
            if (isFileLocked(tempFilePath)) {
                logger.main.error('Файл заблокирован и не может быть удалён')
                event.reply('update-failure', {
                    success: false,
                    error: 'Ошибка при удалении файла',
                })
            } else {
                fs.unlink(tempFilePath, () => {})
                logger.main.error('Ошибка при записи файла:', err)
            }

            if (mainWindow) {
                mainWindow.setProgressBar(-1)
            }

            event.reply('update-failure', { success: false, error: err.message })
        })
    } catch (err) {
        fs.unlink(tempFilePath, () => {})
        logger.main.error('Ошибка при скачивании файла:', err)

        if (mainWindow) {
            mainWindow.setProgressBar(-1)
        }

        event.reply('update-failure', { success: false, error: err.message })
    }
}

export const handlePatcher = (window: BrowserWindow): void => {
    handlePatcherEvents(window)
}
