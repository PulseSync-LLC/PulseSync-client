import { app, BrowserWindow } from 'electron'
import axios from 'axios'
import * as fs from 'original-fs'
import * as path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import logger from '../logger'
import config from '../../../renderer/api/web_config'
import RendererEvents from '../../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import { gunzipAsync, isCompressedArchiveLink, writePatchedAsarAndPatchBundle, zstdDecompressAsync } from './mod-files'
import { t } from '../../i18n'
import { copyFile } from '../../utils/appUtils'
import {
    sendToRenderer,
    resetProgress,
    sendFailure,
    unlinkIfExists,
    restoreBackupIfExists,
    downloadToTempWithProgress,
    DownloadError,
} from './download.helpers'

const UNPACKED_MARKER_FILE = '.pulsesync_unpacked_checksum'
const USER_AGENT = () =>
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

function sha256Hex(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex')
}

async function ensureDir(dir: string): Promise<void> {
    try {
        await fs.promises.mkdir(dir, { recursive: true })
    } catch (err) {
        logger.modManager.warn('Failed to create cache dir:', err)
    }
}

async function pruneCacheFiles(cacheDir: string, keepFile: string, matcher: (file: string) => boolean, warnLabel: string) {
    try {
        const files = await fs.promises.readdir(cacheDir)
        const keepName = path.basename(keepFile)
        for (const file of files) {
            if (file === keepName) continue
            if (!matcher(file)) continue
            try {
                await fs.promises.unlink(path.join(cacheDir, file))
            } catch (e) {
                logger.modManager.warn(warnLabel, file, e)
            }
        }
    } catch (e) {
        logger.modManager.warn('Failed to cleanup cache:', e)
    }
}

function readCachedArchive(cacheFile: string, checksum?: string): Buffer | null {
    if (!fs.existsSync(cacheFile)) return null
    try {
        const cached = fs.readFileSync(cacheFile)
        if (checksum) {
            const cachedHash = sha256Hex(cached)
            if (cachedHash !== checksum) {
                logger.modManager.warn('Cached archive hash mismatch, redownloading')
                try {
                    fs.rmSync(cacheFile, { force: true })
                } catch {}
                return null
            }
        }
        return cached
    } catch (e) {
        logger.modManager.warn('Failed to read cached archive, redownloading:', e)
        return null
    }
}

async function decompressArchive(rawArchive: Buffer, extLower: string): Promise<Buffer> {
    if (extLower === '.zst' || extLower === '.zstd') {
        return (await zstdDecompressAsync(rawArchive as any)) as Buffer
    }
    if (extLower === '.gz') {
        return await gunzipAsync(rawArchive)
    }
    return rawArchive
}

function tryReplaceDir(
    sourceDir: string,
    targetDir: string,
    tempExtractPath: string,
): { ok: true } | { ok: false; error: any; stage: 'move' | 'copy' } {
    try {
        fs.renameSync(sourceDir, targetDir)

        if (sourceDir !== tempExtractPath) {
            fs.rmSync(tempExtractPath, { recursive: true, force: true })
        }
        return { ok: true }
    } catch (err: any) {
        if (err?.code !== 'EXDEV') {
            return { ok: false, error: err, stage: 'move' }
        }
    }

    try {
        fs.cpSync(sourceDir, targetDir, { recursive: true })
        fs.rmSync(tempExtractPath, { recursive: true, force: true })
        return { ok: true }
    } catch (copyErr: any) {
        return { ok: false, error: copyErr, stage: 'copy' }
    }
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
        logger.modManager.error('Mod compatibility check failed:', err)
        return { success: false, message: t('main.modNetwork.compatibilityCheckError') }
    }
}

function isZipBuffer(buf: Buffer): boolean {
    return (
        !!buf &&
        buf.length >= 4 &&
        buf[0] === 0x50 &&
        buf[1] === 0x4b &&
        ((buf[2] === 0x03 && buf[3] === 0x04) || (buf[2] === 0x05 && buf[3] === 0x06) || (buf[2] === 0x07 && buf[3] === 0x08))
    )
}

function extractZipBuffer(zipBuffer: Buffer, destination: string): void {
    fs.rmSync(destination, { recursive: true, force: true })
    fs.mkdirSync(destination, { recursive: true })

    if (!zipBuffer || zipBuffer.length < 4) {
        throw new Error('Invalid ZIP buffer')
    }

    if (!isZipBuffer(zipBuffer)) {
        throw new Error('Expected ZIP archive')
    }

    try {
        const zip = new AdmZip(zipBuffer)
        zip.extractAllTo(destination, true)
    } catch (e: any) {
        throw new Error('Failed to extract ZIP archive')
    }
}

function resolveExtractedRoot(extractDir: string, targetPath: string): string {
    const expectedRootName = path.basename(targetPath)

    let entries: fs.Dirent[]
    try {
        entries = fs.readdirSync(extractDir, { withFileTypes: true })
    } catch {
        return extractDir
    }

    const meaningful = entries.filter(e => {
        const n = e.name
        if (!n) return false
        if (n === '__MACOSX') return false
        return n !== '.DS_Store'
    })

    if (meaningful.length !== 1) return extractDir

    const only = meaningful[0]
    if (!only.isDirectory()) return extractDir
    if (only.name !== expectedRootName) return extractDir

    return path.join(extractDir, only.name)
}

function readUnpackedMarker(targetPath: string): string | null {
    try {
        const markerPath = path.join(targetPath, UNPACKED_MARKER_FILE)
        if (!fs.existsSync(markerPath)) return null
        const v = fs.readFileSync(markerPath, 'utf8').trim()
        return v || null
    } catch {
        return null
    }
}

function writeUnpackedMarker(targetPath: string, checksum: string): void {
    try {
        const markerPath = path.join(targetPath, UNPACKED_MARKER_FILE)
        fs.writeFileSync(markerPath, `${checksum}\n`, 'utf8')
    } catch (e) {
        logger.modManager.warn('Failed to write unpacked marker:', e)
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
    progress?: { base?: number; scale?: number; resetOnComplete?: boolean },
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
        })

        const fileBuffer = fs.readFileSync(tempFilePath)
        const ok = await writePatchedAsarAndPatchBundle(savePath, fileBuffer, link, backupPath, checksum)
        if (checksum && cacheDir) {
            try {
                const cacheFile = path.join(cacheDir, `${checksum}.asar`)
                await ensureDir(cacheDir)
                await copyFile(tempFilePath, cacheFile)
                await pruneCacheFiles(
                    cacheDir,
                    cacheFile,
                    file => file.toLowerCase().endsWith('.asar'),
                    'Failed to remove old asar cache:',
                )
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
    progress?: { base?: number; scale?: number; resetOnComplete?: boolean },
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

        fs.rmSync(targetPath, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })

        const moved = tryReplaceDir(extractedRoot, targetPath, tempExtractPath)
        if (!moved.ok) {
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
        sendFailure(window, { error: err?.message || t('main.modNetwork.unpackedDownloadError'), type: 'download_unpacked_error' })
        return false
    } finally {
        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })
    }
}
