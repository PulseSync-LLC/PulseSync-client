import { app, BrowserWindow } from 'electron'
import axios from 'axios'
import * as fs from 'original-fs'
import * as path from 'path'
import logger from '../../logger'
import config from '@common/appConfig'
import RendererEvents from '../../../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../../handlers/handleErrorsElectron'
import { isCompressedArchiveLink, writePatchedAsarAndPatchBundle } from '../mod-files'
import { t } from '../../../i18n'
import { copyFile } from '../../../utils/appUtils'
import {
    sendToRenderer,
    resetProgress,
    sendFailure,
    unlinkIfExists,
    restoreBackupIfExists,
    downloadToTempWithProgress,
    DownloadError,
} from '../download.helpers'
import { isLinuxAccessError } from '../../../utils/appUtils/elevation'
import type { DownloadProgress, ModCompatibilityResult } from './types'
import {
    decompressArchive,
    ensureDir,
    extractZipBuffer,
    isReplaceDirFailure,
    pruneCacheFiles,
    readCachedArchive,
    readUnpackedMarker,
    resolveExtractedRoot,
    sha256Hex,
    tryReplaceDir,
    writeUnpackedMarker,
} from './helpers'
const USER_AGENT = () =>
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

export async function checkModCompatibility(
    modVersion: string,
    ymVersion: string,
): Promise<ModCompatibilityResult> {
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
        logger.modManager.error('Mod compatibility check failed:', err)
        return { success: false, message: t('main.modNetwork.compatibilityCheckError') }
    }
}

export async function downloadAndUpdateFile(
    window: BrowserWindow,
    link: string,
    tempFilePath: string,
    savePath: string,
    backupPath: string,
    checksum?: string,
    cacheDir?: string,
    progress?: DownloadProgress,
    name?: string
): Promise<boolean> {
    try {
        if (checksum && fs.existsSync(savePath) && !isCompressedArchiveLink(link)) {
            const buf = fs.readFileSync(savePath)
            const currentHash = sha256Hex(buf)
            if (currentHash === checksum) {
                logger.modManager.info('app.asar hash matches, skipping download')
                sendToRenderer(window, RendererEvents.DOWNLOAD_SUCCESS, {
                    success: true,
                    message: t('main.modManager.modAlreadyInstalled'),
                })
                resetProgress(window)
                return true
            }
        }

        await downloadToTempWithProgress({
            window,
            url: link,
            tempFilePath,
            expectedChecksum: checksum,
            userAgent: USER_AGENT(),
            progressScale: progress?.scale ?? 1,
            progressBase: progress?.base ?? 0,
            rejectUnauthorized: false,
            name
        })

        const fileBuffer = fs.readFileSync(tempFilePath)
        const ok = await writePatchedAsarAndPatchBundle(savePath, fileBuffer, link, backupPath, checksum)
        if (checksum && cacheDir) {
            try {
                const cacheFile = path.join(cacheDir, `${checksum}.asar`)
                await ensureDir(cacheDir)
                await copyFile(tempFilePath, cacheFile)
                await pruneCacheFiles(cacheDir, cacheFile, file => file.toLowerCase().endsWith('.asar'), 'Failed to remove old asar cache:')
            } catch (e: any) {
                logger.modManager.warn('Failed to cache mod:', e)
            }
        }

        unlinkIfExists(tempFilePath)

        if (!ok) {
            sendFailure(window, { error: t('main.modNetwork.patchError'), type: 'patch_error' })
            return false
        }

        if (progress?.resetOnComplete ?? true) {
            resetProgress(window)
        }
        return true
    } catch (err: any) {
        unlinkIfExists(tempFilePath)
        restoreBackupIfExists(savePath, backupPath)
        logger.modManager.error('File download/install error:', err)
        logger.modManager.error('Error details:', {
            code: err?.code,
            message: err?.message,
            stack: err?.stack,
        })
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'pipeline', 'catch', err)

        if (isLinuxAccessError(err)) {
            sendFailure(window, {
                error: t('main.modManager.linuxPermissionsRequired'),
                type: 'linux_permissions_required',
            })
            return false
        }

        if (err instanceof DownloadError && err.code === 'checksum_mismatch') {
            sendFailure(window, {
                error: t('main.modNetwork.integrityError'),
                type: 'checksum_mismatch',
            })
        } else {
            sendFailure(window, { error: err?.message || t('main.modDownload.networkError'), type: 'download_error' })
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
    progress?: DownloadProgress,
): Promise<boolean> {
    try {
        if (checksum && fs.existsSync(targetPath)) {
            const installed = readUnpackedMarker(targetPath)
            if (installed && installed === checksum) {
                logger.modManager.info('app.asar.unpacked hash matches, skipping')
                if (progress?.resetOnComplete ?? true) {
                    resetProgress(window)
                }
                return true
            }
            if (installed && installed !== checksum) {
                logger.modManager.info(`app.asar.unpacked hash mismatch, reinstalling`)
                try {
                    fs.rmSync(targetPath, { recursive: true, force: true })
                } catch (e) {
                    logger.modManager.warn('Failed to remove old unpacked dir:', e)
                }
            }
        }

        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })

        const pathname = new URL(link).pathname
        const ext = path.extname(pathname) || '.zip'
        const extLower = ext.toLowerCase()
        let rawArchive: Buffer | null = null

        let cacheFile: string | null = null

        if (cacheDir) {
            await ensureDir(cacheDir)

            if (checksum) {
                cacheFile = path.join(cacheDir, `${checksum}${ext}`)
                const cached = readCachedArchive(cacheFile, checksum)
                if (cached) {
                    logger.modManager.info('Using cached unpacked archive')
                    rawArchive = cached
                }
            }
        }

        if (!rawArchive) {
            await downloadToTempWithProgress({
                window,
                url: link,
                tempFilePath: tempArchivePath,
                userAgent: USER_AGENT(),
                progressScale: progress?.scale ?? 1,
                progressBase: progress?.base ?? 0,
                rejectUnauthorized: false,
                expectedChecksum: checksum,
                name: 'app.asar.unpacked'
            })

            rawArchive = fs.readFileSync(tempArchivePath)

            if (cacheDir) {
                try {
                    if (!cacheFile) {
                        const fileHash = sha256Hex(rawArchive)
                        cacheFile = path.join(cacheDir, `${fileHash}${ext}`)
                    }

                    await copyFile(tempArchivePath, cacheFile)
                    await pruneCacheFiles(cacheDir, cacheFile, file => file.toLowerCase().endsWith(extLower), 'Failed to remove old unpacked cache:')
                } catch (e: any) {
                    logger.modManager.warn('Failed to cache unpacked archive:', e)
                }
            }
        }

        const zipBuffer = await decompressArchive(rawArchive as Buffer, extLower)

        extractZipBuffer(zipBuffer, tempExtractPath)

        const extractedRoot = resolveExtractedRoot(tempExtractPath, targetPath)

        fs.mkdirSync(path.dirname(targetPath), { recursive: true })

        const moved = await tryReplaceDir(extractedRoot, targetPath, tempExtractPath)
        if (isReplaceDirFailure(moved)) {
            if (isLinuxAccessError(moved.error)) {
                sendFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' })
                return false
            }
            const messageKey = moved.stage === 'copy' ? 'main.modNetwork.unpackedCopyError' : 'main.modNetwork.unpackedMoveError'
            logger.modManager.error('Failed to replace unpacked dir:', moved.error)
            sendFailure(window, { error: moved.error?.message || t(messageKey), type: 'download_unpacked_error' })
            return false
        }

        if (checksum) {
            writeUnpackedMarker(targetPath, checksum)
        }

        if (progress?.resetOnComplete ?? true) {
            resetProgress(window)
        }
        return true
    } catch (err: any) {
        logger.modManager.error('Failed to download/extract unpacked:', err)
        if (isLinuxAccessError(err)) {
            sendFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' })
            return false
        }
        sendFailure(window, { error: err?.message || t('main.modNetwork.unpackedDownloadError'), type: 'download_unpacked_error' })
        return false
    } finally {
        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })
    }
}
