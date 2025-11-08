import { app, BrowserWindow } from 'electron'
import axios from 'axios'
import * as fs from 'original-fs'
import crypto from 'crypto'
import logger from '../logger'
import config from '../../../renderer/api/web_config'
import RendererEvents from '../../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { writePatchedAsarAndPatchBundle } from './mod-files'
import {
    sendToRenderer,
    resetProgress,
    sendFailure,
    unlinkIfExists,
    restoreBackupIfExists,
    downloadToTempWithProgress,
    DownloadError,
} from './download.helpers'

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

        const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

        await downloadToTempWithProgress({
            window,
            url: link,
            tempFilePath,
            expectedChecksum: checksum,
            userAgent: ua,
            progressScale: 0.6,
            rejectUnauthorized: false,
        })

        const fileBuffer = fs.readFileSync(tempFilePath)
        const ok = await writePatchedAsarAndPatchBundle(window, savePath, fileBuffer, link, backupPath)
        unlinkIfExists(tempFilePath)

        if (!ok) {
            sendFailure(window, { error: 'Ошибка при патчинге ASAR', type: 'patch_error' })
            return false
        }

        resetProgress(window)
        return true
    } catch (err: any) {
        unlinkIfExists(tempFilePath)
        restoreBackupIfExists(savePath, backupPath)
        logger.modManager.error('Ошибка во время загрузки/установки файла:', err)
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'pipeline', 'catch', err)

        if (err instanceof DownloadError && err.code === 'checksum_mismatch') {
            sendFailure(window, { error: 'Ошибка целостности файла.', type: 'checksum_mismatch' })
        } else {
            sendFailure(window, { error: err?.message || 'Ошибка сети', type: 'download_error' })
        }
        return false
    }
}
