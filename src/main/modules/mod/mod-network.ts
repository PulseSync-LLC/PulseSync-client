import { app, BrowserWindow } from 'electron'
import axios from 'axios'
import * as fs from 'original-fs'
import * as path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import { Readable } from 'stream'
import tar from 'tar'
import { pipeline } from 'stream/promises'
import logger from '../logger'
import config from '../../../renderer/api/web_config'
import RendererEvents from '../../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { gunzipAsync, writePatchedAsarAndPatchBundle, zstdDecompressAsync } from './mod-files'
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

async function extractArchiveBuffer(archive: Buffer, destination: string, archiveName: string): Promise<void> {
    fs.rmSync(destination, { recursive: true, force: true })
    fs.mkdirSync(destination, { recursive: true })

    const archiveType: 'zip' | 'tar' | 'unknown' = archiveName.endsWith('.zip') ? 'zip' : archiveName.endsWith('.tar') ? 'tar' : 'unknown'

    if (archiveType === 'zip') {
        const zip = new AdmZip(archive)
        zip.extractAllTo(destination, true)
        return
    }

    if (archiveType === 'tar') {
        await pipeline(Readable.from(archive), tar.x({ cwd: destination }))
        return
    }

    throw new Error('Неизвестный формат архива app.asar.unpacked')
}

export async function downloadAndUpdateFile(
    window: BrowserWindow,
    link: string,
    tempFilePath: string,
    savePath: string,
    backupPath: string,
    checksum?: string,
    cacheDir?: string,
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
        if (checksum && cacheDir) {
            try {
                const cacheFile = path.join(cacheDir, `${checksum}.asar`)
                await fs.promises.mkdir(cacheDir, { recursive: true })
                await fs.promises.copyFile(tempFilePath, cacheFile)

                try {
                    const files = await fs.promises.readdir(cacheDir)
                    for (const f of files) {
                        if (f === path.basename(cacheFile)) continue
                        if (f.toLowerCase().endsWith('.asar')) {
                            try {
                                await fs.promises.unlink(path.join(cacheDir, f))
                            } catch (e) {
                                logger.modManager.warn('Failed to remove old asar cache file:', f, e)
                            }
                        }
                    }
                } catch (e: any) {
                    logger.modManager.warn('Failed to cleanup old asar cache files:', e)
                }
            } catch (e: any) {
                logger.modManager.warn('Failed to cache downloaded mod (inside downloadAndUpdateFile):', e)
            }
        }

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

export async function downloadAndExtractUnpacked(
    window: BrowserWindow,
    link: string,
    tempArchivePath: string,
    tempExtractPath: string,
    targetPath: string,
    checksum?: string,
    cacheDir?: string,
): Promise<boolean> {
    try {
        const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })

        const pathname = new URL(link).pathname
        const ext = path.extname(pathname) || ''
        let rawArchive: Buffer | null = null

        if (checksum && cacheDir) {
            try {
                await fs.promises.mkdir(cacheDir, { recursive: true })
            } catch (err) {
                logger.modManager.warn('Failed to create cache dir for unpacked:', err)
            }
            const cacheFile = path.join(cacheDir, `${checksum}${ext}`)
            if (fs.existsSync(cacheFile)) {
                logger.modManager.info('Found cached unpacked archive, using it')
                rawArchive = fs.readFileSync(cacheFile)
            }
        }

        if (!rawArchive) {
            await downloadToTempWithProgress({
                window,
                url: link,
                tempFilePath: tempArchivePath,
                userAgent: ua,
                progressScale: 0.4,
                rejectUnauthorized: false,
                expectedChecksum: checksum,
            })

            rawArchive = fs.readFileSync(tempArchivePath)

            if (checksum && cacheDir) {
                try {
                    const cacheFile = path.join(cacheDir, `${checksum}${ext}`)
                    await fs.promises.mkdir(cacheDir, { recursive: true })
                    await fs.promises.copyFile(tempArchivePath, cacheFile)

                    // Очистим старые кеш-файлы с тем же расширением (оставим только текущий)
                    try {
                        const files = await fs.promises.readdir(cacheDir)
                        for (const f of files) {
                            if (f === path.basename(cacheFile)) continue
                            if (f.toLowerCase().endsWith(ext.toLowerCase())) {
                                try {
                                    await fs.promises.unlink(path.join(cacheDir, f))
                                } catch (e) {
                                    logger.modManager.warn('Failed to remove old unpacked cache file:', f, e)
                                }
                            }
                        }
                    } catch (e: any) {
                        logger.modManager.warn('Failed to cleanup old unpacked cache files:', e)
                    }

                } catch (e: any) {
                    logger.modManager.warn('Failed to cache unpacked archive:', e)
                }
            }
        }

        const lowerPath = pathname.toLowerCase()
        let decompressedArchive: Buffer
        if (lowerPath.endsWith('.zst') || lowerPath.endsWith('.zstd')) {
            decompressedArchive = (await zstdDecompressAsync(rawArchive as any)) as Buffer
        } else if (lowerPath.endsWith('.gz')) {
            decompressedArchive = await gunzipAsync(rawArchive)
        } else {
            logger.modManager.error('Неизвестное расширение архива app.asar.unpacked:', pathname)
            sendFailure(window, { error: 'Неизвестное расширение архива app.asar.unpacked', type: 'download_unpacked_error' })
            return false
        }

        const archiveName = pathname.replace(/\.(zst|zstd|gz)$/i, '')
        await extractArchiveBuffer(decompressedArchive, tempExtractPath, archiveName)

        fs.rmSync(targetPath, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })

        try {
            fs.renameSync(tempExtractPath, targetPath)
        } catch (err: any) {
            if (err?.code !== 'EXDEV') {
                logger.modManager.error('Ошибка при перемещении распакованной папки:', err)
                sendFailure(window, { error: err?.message || 'Ошибка перемещения unpacked', type: 'download_unpacked_error' })
                return false
            }

            try {
                fs.cpSync(tempExtractPath, targetPath, { recursive: true })
                fs.rmSync(tempExtractPath, { recursive: true, force: true })
            } catch (copyErr: any) {
                logger.modManager.error('Ошибка при копировании распакованной папки:', copyErr)
                sendFailure(window, { error: copyErr?.message || 'Ошибка копирования unpacked', type: 'download_unpacked_error' })
                return false
            }
        }

        resetProgress(window)
        return true
    } catch (err: any) {
        logger.modManager.error('Ошибка во время загрузки app.asar.unpacked:', err)
        sendFailure(window, { error: err?.message || 'Ошибка загрузки app.asar.unpacked', type: 'download_unpacked_error' })
        return false
    } finally {
        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })
    }
}
