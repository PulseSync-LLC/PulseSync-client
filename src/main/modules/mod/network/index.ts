import { app, BrowserWindow } from 'electron'
import axios from 'axios'
import * as fs from 'original-fs'
import * as path from 'path'
import logger from '../../logger'
import { HandleErrorsElectron } from '../../handlers/handleErrorsElectron'
import { installPreparedAsarAndPatchBundle, isCompressedArchiveLink } from '../mod-files'
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
    sendProgress,
    setProgress,
} from '../download.helpers'
import { isLinuxAccessError } from '../../../utils/appUtils/elevation'
import type { DownloadProgress, ModDownloadFailure } from './types'
import {
    ensureDir,
    isCachedArchiveValid,
    pruneCacheDirectories,
    pruneCacheFiles,
    readUnpackedMarker,
    sha256File,
    UNPACKED_MARKER_FILE,
    writeUnpackedMarker,
} from './helpers'
import { ArtifactWorkerError, hashArtifactInWorker, installUnpackedArtifactInWorker, prepareAsarArtifactInWorker } from './artifactWorkerClient'
const USER_AGENT = () =>
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`
const NETWORK_PROGRESS_RATIO = 0.85
const DERIVED_UNPACKED_DIRECTORY_SUFFIX = '.unpacked-dir'
const LEGACY_PREPARED_UNPACKED_SUFFIX = '.unpacked.zip'
const DERIVED_CACHE_RECOVERY_STAGES = new Set(['read', 'decompress', 'extract'])

function reportArtifactProgress(window: BrowserWindow, fraction: number, name: string): void {
    const boundedFraction = Math.min(Math.max(fraction, 0), 1)
    setProgress(window, boundedFraction)
    sendProgress(window, Math.round(boundedFraction * 100), name)
}

async function isCachedUnpackedDirectoryValid(directoryPath: string, checksum: string): Promise<boolean> {
    try {
        const stats = await fs.promises.stat(directoryPath)
        return stats.isDirectory() && readUnpackedMarker(directoryPath) === checksum
    } catch {
        return false
    }
}

function reportFailure(window: BrowserWindow, failure: ModDownloadFailure, onFailure?: (failure: ModDownloadFailure) => void) {
    if (onFailure) {
        onFailure(failure)
        resetProgress(window)
        return
    }

    sendFailure(window, failure)
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
    name?: string,
    onFailure?: (failure: ModDownloadFailure) => void,
): Promise<boolean> {
    const preparedFilePath = `${tempFilePath}.prepared.${process.pid}.${Date.now()}.asar`
    const progressBase = progress?.base ?? 0
    const progressScale = progress?.scale ?? 1
    const networkProgressScale = progressScale * NETWORK_PROGRESS_RATIO
    const completedProgress = progressBase + progressScale
    const artifactName = name ?? 'app.asar'
    try {
        if (checksum && fs.existsSync(savePath) && !isCompressedArchiveLink(link)) {
            const currentHash = (await hashArtifactInWorker({ filePath: savePath })).checksum
            if (currentHash === checksum) {
                logger.modManager.info('app.asar hash matches, skipping download')
                reportArtifactProgress(window, completedProgress, artifactName)
                return true
            }
        }

        await downloadToTempWithProgress({
            window,
            url: link,
            tempFilePath,
            expectedChecksum: checksum,
            userAgent: USER_AGENT(),
            progressScale: networkProgressScale,
            progressBase,
            rejectUnauthorized: false,
            name: artifactName,
        })

        reportArtifactProgress(window, progressBase + networkProgressScale, artifactName)
        const ok = await prepareAndInstallAsarArtifact(tempFilePath, preparedFilePath, link, savePath, backupPath, checksum)
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
            reportFailure(window, { error: t('main.modNetwork.patchError'), type: 'patch_error' }, onFailure)
            return false
        }

        reportArtifactProgress(window, completedProgress, artifactName)
        if (progress?.resetOnComplete ?? true) {
            resetProgress(window)
        }
        return true
    } catch (err: any) {
        unlinkIfExists(tempFilePath)
        unlinkIfExists(preparedFilePath)
        restoreBackupIfExists(savePath, backupPath)
        logger.modManager.error('File download/install error:', err)
        logger.modManager.error('Error details:', {
            code: err?.code,
            message: err?.message,
            stack: err?.stack,
        })
        HandleErrorsElectron.handleError('downloadAndUpdateFile', 'pipeline', 'catch', err)

        if (isLinuxAccessError(err)) {
            reportFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' }, onFailure)
            return false
        }

        if (
            (err instanceof DownloadError && err.code === 'checksum_mismatch') ||
            (err instanceof ArtifactWorkerError && err.code === 'CHECKSUM_MISMATCH')
        ) {
            reportFailure(window, { error: t('main.modNetwork.integrityError'), type: 'checksum_mismatch' }, onFailure)
        } else {
            reportFailure(window, { error: err?.message || t('main.modDownload.networkError'), type: 'download_error' }, onFailure)
        }
        return false
    }
}

export async function prepareAndInstallAsarArtifact(
    archivePath: string,
    preparedFilePath: string,
    link: string,
    savePath: string,
    backupPath: string,
    checksum?: string,
): Promise<boolean> {
    const extension = path.extname(new URL(link).pathname).toLowerCase()
    const startedAt = Date.now()

    try {
        const workerResult = await prepareAsarArtifactInWorker({
            archivePath,
            archiveExtension: extension,
            expectedChecksum: checksum,
            outputPath: preparedFilePath,
        })
        logger.modManager.info('Prepared app.asar in worker', {
            totalMs: Date.now() - startedAt,
            workerThreadId: workerResult.workerThreadId,
            ...workerResult.durations,
        })
        for (const warning of workerResult.warnings) {
            logger.modManager.warn('ASAR worker warning:', warning)
        }
        return await installPreparedAsarAndPatchBundle(savePath, workerResult.preparedPath, backupPath)
    } finally {
        await fs.promises.rm(preparedFilePath, { force: true }).catch(() => {})
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
    onFailure?: (failure: ModDownloadFailure) => void,
): Promise<boolean> {
    const progressBase = progress?.base ?? 0
    const progressScale = progress?.scale ?? 1
    const networkProgressScale = progressScale * NETWORK_PROGRESS_RATIO
    const completedProgress = progressBase + progressScale
    const artifactName = 'app.asar.unpacked'
    const preflightStartedAt = Date.now()
    try {
        const markerStartedAt = Date.now()
        if (checksum && fs.existsSync(targetPath)) {
            const installed = readUnpackedMarker(targetPath)
            if (installed && installed === checksum) {
                logger.modManager.info('app.asar.unpacked hash matches, skipping')
                reportArtifactProgress(window, completedProgress, artifactName)
                if (progress?.resetOnComplete ?? true) {
                    resetProgress(window)
                }
                return true
            }
            if (installed && installed !== checksum) {
                logger.modManager.info(`app.asar.unpacked hash mismatch, reinstalling`)
            }
        }
        const markerMs = Date.now() - markerStartedAt

        const tempCleanupStartedAt = Date.now()
        unlinkIfExists(tempArchivePath)
        const tempCleanupMs = Date.now() - tempCleanupStartedAt

        const pathname = new URL(link).pathname
        const ext = path.extname(pathname) || '.zip'
        const extLower = ext.toLowerCase()
        let cacheFile: string | null = null
        let preparedCacheDirectory: string | null = null
        let legacyPreparedCacheFile: string | null = null
        let sourceKind: 'archive' | 'directory' = 'archive'
        let archivePath = tempArchivePath
        let archiveExtension = extLower
        let archiveChecksum = checksum
        let downloaded = false

        if (cacheDir) {
            const cacheDirStartedAt = Date.now()
            await ensureDir(cacheDir)
            const cacheDirMs = Date.now() - cacheDirStartedAt

            if (checksum) {
                cacheFile = path.join(cacheDir, `${checksum}${ext}`)
                if (extLower !== '.zip') {
                    preparedCacheDirectory = path.join(cacheDir, `${checksum}${DERIVED_UNPACKED_DIRECTORY_SUFFIX}`)
                    legacyPreparedCacheFile = path.join(cacheDir, `${checksum}${LEGACY_PREPARED_UNPACKED_SUFFIX}`)
                }
                const cacheValidationStartedAt = Date.now()
                const validPreparedCacheDirectory =
                    preparedCacheDirectory && (await isCachedUnpackedDirectoryValid(preparedCacheDirectory, checksum)) ? preparedCacheDirectory : null
                if (validPreparedCacheDirectory) {
                    logger.modManager.info('Using cached extracted app.asar.unpacked', {
                        preflightMs: Date.now() - preflightStartedAt,
                        markerMs,
                        tempCleanupMs,
                        cacheDirMs,
                        cacheValidationMs: Date.now() - cacheValidationStartedAt,
                    })
                    sourceKind = 'directory'
                    archivePath = validPreparedCacheDirectory
                    archiveExtension = ''
                    archiveChecksum = undefined
                } else {
                    if (preparedCacheDirectory) {
                        await fs.promises.rm(preparedCacheDirectory, { recursive: true, force: true }).catch(() => {})
                    }

                    if (legacyPreparedCacheFile && (await isCachedArchiveValid(legacyPreparedCacheFile))) {
                        logger.modManager.info('Using legacy prepared unpacked ZIP', {
                            preflightMs: Date.now() - preflightStartedAt,
                            markerMs,
                            tempCleanupMs,
                            cacheDirMs,
                            cacheValidationMs: Date.now() - cacheValidationStartedAt,
                        })
                        archivePath = legacyPreparedCacheFile
                        archiveExtension = '.zip'
                        archiveChecksum = undefined
                    } else if (await isCachedArchiveValid(cacheFile)) {
                        logger.modManager.info('Using cached unpacked archive', {
                            preflightMs: Date.now() - preflightStartedAt,
                            markerMs,
                            tempCleanupMs,
                            cacheDirMs,
                            cacheValidationMs: Date.now() - cacheValidationStartedAt,
                        })
                        archivePath = cacheFile
                    }
                }
            }
        }

        const downloadArchive = async (): Promise<void> => {
            await downloadToTempWithProgress({
                window,
                url: link,
                tempFilePath: tempArchivePath,
                userAgent: USER_AGENT(),
                progressScale: networkProgressScale,
                progressBase,
                rejectUnauthorized: false,
                expectedChecksum: checksum,
                name: artifactName,
            })
            downloaded = true
            sourceKind = 'archive'
            archivePath = tempArchivePath
            archiveExtension = extLower
            archiveChecksum = checksum
        }

        if (archivePath === tempArchivePath) {
            await downloadArchive()
        }

        reportArtifactProgress(window, progressBase + networkProgressScale, artifactName)
        const processArchive = () =>
            installUnpackedArtifactInWorker({
                sourceKind,
                archivePath,
                archiveExtension,
                expectedChecksum: archiveChecksum,
                preparedDirectoryPath: preparedCacheDirectory && sourceKind === 'archive' ? preparedCacheDirectory : undefined,
                preparedDirectoryMarker:
                    preparedCacheDirectory && sourceKind === 'archive' && checksum ? { fileName: UNPACKED_MARKER_FILE, value: checksum } : undefined,
                stagingPath: tempExtractPath,
                targetPath,
            })

        let workerStartedAt = Date.now()
        let workerResult
        for (let attempt = 0; ; attempt++) {
            try {
                workerResult = await processArchive()
                break
            } catch (error) {
                const canRecoverDirectoryCache =
                    attempt === 0 &&
                    preparedCacheDirectory !== null &&
                    sourceKind === 'directory' &&
                    archivePath === preparedCacheDirectory &&
                    error instanceof ArtifactWorkerError &&
                    error.stage === 'extract'
                if (canRecoverDirectoryCache) {
                    const invalidPreparedCacheDirectory = preparedCacheDirectory as string
                    logger.modManager.warn('Extracted unpacked cache is invalid, rebuilding:', error)
                    await fs.promises.rm(invalidPreparedCacheDirectory, { recursive: true, force: true }).catch(() => {})
                    sourceKind = 'archive'
                    if (legacyPreparedCacheFile && (await isCachedArchiveValid(legacyPreparedCacheFile))) {
                        archivePath = legacyPreparedCacheFile
                        archiveExtension = '.zip'
                        archiveChecksum = undefined
                    } else if (cacheFile && (await isCachedArchiveValid(cacheFile))) {
                        archivePath = cacheFile
                        archiveExtension = extLower
                        archiveChecksum = checksum
                    } else {
                        await downloadArchive()
                    }
                    workerStartedAt = Date.now()
                    continue
                }

                const canRecoverLegacyPreparedCache =
                    attempt <= 1 &&
                    legacyPreparedCacheFile !== null &&
                    archivePath === legacyPreparedCacheFile &&
                    error instanceof ArtifactWorkerError &&
                    DERIVED_CACHE_RECOVERY_STAGES.has(error.stage)
                if (canRecoverLegacyPreparedCache) {
                    const invalidLegacyPreparedCacheFile = legacyPreparedCacheFile as string
                    logger.modManager.warn('Legacy prepared unpacked ZIP is invalid, rebuilding:', error)
                    await fs.promises.rm(invalidLegacyPreparedCacheFile, { force: true }).catch(() => {})
                    if (cacheFile && (await isCachedArchiveValid(cacheFile))) {
                        sourceKind = 'archive'
                        archivePath = cacheFile
                        archiveExtension = extLower
                        archiveChecksum = checksum
                    } else {
                        await downloadArchive()
                    }
                    workerStartedAt = Date.now()
                    continue
                }

                const canRecoverSourceCache =
                    attempt <= 1 &&
                    cacheFile !== null &&
                    archivePath === cacheFile &&
                    error instanceof ArtifactWorkerError &&
                    error.code === 'CHECKSUM_MISMATCH'
                if (!canRecoverSourceCache) throw error

                const invalidSourceCacheFile = cacheFile as string
                logger.modManager.warn('Cached unpacked archive hash mismatch, redownloading')
                await fs.promises.rm(invalidSourceCacheFile, { force: true }).catch(() => {})
                await downloadArchive()
                workerStartedAt = Date.now()
            }
        }
        logger.modManager.info('Processed app.asar.unpacked in worker', {
            totalMs: Date.now() - workerStartedAt,
            workerThreadId: workerResult.workerThreadId,
            ...workerResult.durations,
        })
        for (const warning of workerResult.warnings) {
            logger.modManager.warn('Artifact worker warning:', warning)
        }

        if (checksum) {
            writeUnpackedMarker(targetPath, checksum)
        }

        if (downloaded && cacheDir) {
            try {
                if (!cacheFile) {
                    cacheFile = path.join(cacheDir, `${await sha256File(tempArchivePath)}${ext}`)
                }
                await copyFile(tempArchivePath, cacheFile)
                await pruneCacheFiles(cacheDir, cacheFile, file => file.toLowerCase().endsWith(extLower), 'Failed to remove old unpacked cache:')
            } catch (e: any) {
                logger.modManager.warn('Failed to cache unpacked archive:', e)
            }
        }

        if (preparedCacheDirectory && cacheDir && checksum && (await isCachedUnpackedDirectoryValid(preparedCacheDirectory, checksum))) {
            await pruneCacheDirectories(
                cacheDir,
                preparedCacheDirectory,
                directory => directory.toLowerCase().endsWith(DERIVED_UNPACKED_DIRECTORY_SUFFIX),
                'Failed to remove old extracted unpacked cache:',
            )
            if (legacyPreparedCacheFile) {
                await fs.promises.rm(legacyPreparedCacheFile, { force: true }).catch(() => {})
            }
        }

        reportArtifactProgress(window, completedProgress, artifactName)
        if (progress?.resetOnComplete ?? true) {
            resetProgress(window)
        }
        return true
    } catch (err: any) {
        logger.modManager.error('Failed to download/extract unpacked:', err)
        if (isLinuxAccessError(err)) {
            reportFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' }, onFailure)
            return false
        }
        if (err instanceof ArtifactWorkerError) {
            logger.modManager.error('Artifact worker failed:', {
                stage: err.stage,
                code: err.code,
                message: err.message,
            })
        }
        reportFailure(window, { error: err?.message || t('main.modNetwork.unpackedDownloadError'), type: 'download_unpacked_error' }, onFailure)
        return false
    } finally {
        unlinkIfExists(tempArchivePath)
        await fs.promises.rm(tempExtractPath, { recursive: true, force: true }).catch(() => {})
    }
}
