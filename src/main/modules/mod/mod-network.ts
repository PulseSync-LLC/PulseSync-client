import { BrowserWindow } from 'electron'
import * as https from 'https'
import axios from 'axios'
import * as fs from 'original-fs'
import * as path from 'path'
import crypto from 'crypto'
import logger from '../logger'
import config from '../../../renderer/api/web_config'
import RendererEvents from '../../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { writePatchedAsarAndPatchBundle } from './mod-files'

function sendToRenderer(window: BrowserWindow | null | undefined, channel: any, payload: any) {
    window?.webContents.send(channel, payload)
}

function setProgress(window: BrowserWindow | null | undefined, frac: number) {
    window?.setProgressBar(frac)
}

function resetProgress(window: BrowserWindow | null | undefined) {
    window?.setProgressBar(-1)
}

function sendFailure(
    window: BrowserWindow,
    params: { error: string; type?: string; url?: string; requiredVersion?: string; recommendedVersion?: string },
) {
    sendToRenderer(window, RendererEvents.DOWNLOAD_FAILURE, { success: false, ...params })
    resetProgress(window)
}

export async function checkModCompatibility(
    modVersion: string,
    ymVersion: string,
): Promise<{
    success: boolean
    message?: string
    code?: string
    url?: string
    requiredVersion?: string
    recommendedVersion?: string
}> {
    try {
        const resp = await axios.get(`${config.SERVER_URL}/api/v1/mod/v2/check`, {
            params: { yandexVersion: ymVersion, modVersion },
        })
        const d = resp.data
        if (d.error) return { success: false, message: d.error }
        return {
            success: d.success ?? false,
            message: d.message,
            code: d.code,
            url: d.url,
            requiredVersion: d.requiredVersion,
            recommendedVersion: d.recommendedVersion || modVersion,
        }
    } catch (err) {
        logger.modManager.error('Ошибка при проверке совместимости мода:', err)
        return { success: false, message: 'Произошла ошибка при проверке совместимости мода.' }
    }
}

export async function downloadAndUpdateFile(
    window: BrowserWindow,
    link: string,
    tempFilePath: string,
    savePath: string,
    backupPath: string,
    checksum?: string,
): Promise<boolean> {
    let isFinished = false
    let isError = false

    try {
        if (checksum && fs.existsSync(savePath)) {
            const buf = fs.readFileSync(savePath)
            const currentHash = crypto.createHash('sha256').update(buf).digest('hex')
            if (currentHash === checksum) {
                logger.modManager.info('app.asar совпадает с checksum, пропускаем загрузку')
                sendToRenderer(window, RendererEvents.DOWNLOAD_SUCCESS, { success: true, message: 'Мод уже установлен.' })
                resetProgress(window)
                return true
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
            const frac = total > 0 ? downloaded / total : 0
            setProgress(window, Math.min(frac * 0.6, 0.6))
            sendToRenderer(window, RendererEvents.DOWNLOAD_PROGRESS, { progress: Math.round(Math.min(frac, 1) * 100) })
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
            if (fs.existsSync(backupPath)) fs.renameSync(backupPath, savePath)
            HandleErrorsElectron.handleError('downloadAndUpdateFile', 'responseData', 'on error', err)
            logger.http.error('Download error:', (err as any).message)
            sendFailure(window, { error: 'Ошибка при скачивании. Проверьте интернет.', type: 'download_error' })
        })

        return await new Promise<boolean>(resolve => {
            writer.on('finish', async () => {
                if (!isFinished || isError) return resolve(false)
                try {
                    const fileBuffer = fs.readFileSync(tempFilePath)
                    if (checksum) {
                        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
                        if (hash !== checksum) {
                            fs.unlinkSync(tempFilePath)
                            sendFailure(window, { error: 'Ошибка целостности файла.', type: 'checksum_mismatch' })
                            return resolve(false)
                        }
                    }
                    const ok = await writePatchedAsarAndPatchBundle(window, savePath, fileBuffer, link, backupPath)
                    fs.unlinkSync(tempFilePath)
                    if (!ok) {
                        sendFailure(window, { error: 'Ошибка при патчинге ASAR', type: 'patch_error' })
                        return resolve(false)
                    }
                    resetProgress(window)
                    resolve(true)
                } catch (e: any) {
                    fs.unlink(tempFilePath, () => {})
                    if (fs.existsSync(backupPath)) fs.renameSync(backupPath, savePath)
                    logger.modManager.error('Error processing downloaded file:', e)
                    HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.finish', 'try-catch', e)
                    sendFailure(window, { error: e.message, type: 'finish_error' })
                    resolve(false)
                }
            })
            writer.on('error', (err: Error) => {
                fs.unlink(tempFilePath, () => {})
                logger.modManager.error('Error writing file:', err)
                HandleErrorsElectron.handleError('downloadAndUpdateFile', 'writer.error', 'on error', err)
                sendFailure(window, { error: (err as any).message, type: 'writer_error' })
                resolve(false)
            })
        })
    } catch (err: any) {
        fs.unlink(tempFilePath, () => {})
        logger.modManager.error('Error downloading file:', err)
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'axios.get', 'outer catch', err)
        sendFailure(window, { error: err.message, type: 'download_outer_error' })
        return false
    }
}
