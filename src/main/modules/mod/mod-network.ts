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

const UNPACKED_MARKER_FILE = '.pulsesync_unpacked_checksum'

function sha256Hex(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex')
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
        return { success: false, message: 'Произошла ошибка при проверке совместимости мода.' }
    }
}

function isZipBuffer(buf: Buffer): boolean {
    if (!buf || buf.length < 4) return false
    const a = buf[0]
    const b = buf[1]
    const c = buf[2]
    const d = buf[3]
    const isPK = a === 0x50 && b === 0x4b
    const isLocal = c === 0x03 && d === 0x04
    const isEmpty = c === 0x05 && d === 0x06
    const isSpanned = c === 0x07 && d === 0x08
    return isPK && (isLocal || isEmpty || isSpanned)
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
        if (n === '.DS_Store') return false
        return true
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
): Promise<boolean> {
    try {
        if (checksum && fs.existsSync(savePath)) {
            const buf = fs.readFileSync(savePath)
            const currentHash = sha256Hex(buf)
            if (currentHash === checksum) {
                logger.modManager.info('app.asar hash matches, skipping download')
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
                                logger.modManager.warn('Failed to remove old asar cache:', f, e)
                            }
                        }
                    }
                } catch (e: any) {
                    logger.modManager.warn('Failed to cleanup old asar cache:', e)
                }
            } catch (e: any) {
                logger.modManager.warn('Failed to cache mod:', e)
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
        logger.modManager.error('File download/install error:', err)
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
        if (checksum && fs.existsSync(targetPath)) {
            const installed = readUnpackedMarker(targetPath)
            if (installed && installed === checksum) {
                logger.modManager.info('app.asar.unpacked hash matches, skipping')
                resetProgress(window)
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

        const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })

        const pathname = new URL(link).pathname
        const ext = path.extname(pathname) || '.zip'
        let rawArchive: Buffer | null = null

        let cacheFile: string | null = null

        if (cacheDir) {
            try {
                await fs.promises.mkdir(cacheDir, { recursive: true })
            } catch (err) {
                logger.modManager.warn('Failed to create cache dir:', err)
            }

            if (checksum) {
                cacheFile = path.join(cacheDir, `${checksum}${ext}`)
                if (fs.existsSync(cacheFile)) {
                    try {
                        const cached = fs.readFileSync(cacheFile)
                        const cachedHash = sha256Hex(cached)
                        if (cachedHash === checksum) {
                            logger.modManager.info('Using cached unpacked archive')
                            rawArchive = cached
                        } else {
                            logger.modManager.warn('Cached unpacked archive hash mismatch, redownloading')
                            try {
                                fs.rmSync(cacheFile, { force: true })
                            } catch {}
                        }
                    } catch (e) {
                        logger.modManager.warn('Failed to read cached unpacked, redownloading:', e)
                    }
                }
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

            if (cacheDir) {
                try {
                    if (!cacheFile) {
                        const fileHash = sha256Hex(rawArchive)
                        cacheFile = path.join(cacheDir, `${fileHash}${ext}`)
                    }

                    await fs.promises.copyFile(tempArchivePath, cacheFile)

                    try {
                        const files = await fs.promises.readdir(cacheDir)
                        for (const f of files) {
                            if (f === path.basename(cacheFile)) continue
                            if (ext && f.toLowerCase().endsWith(ext.toLowerCase())) {
                                try {
                                    await fs.promises.unlink(path.join(cacheDir, f))
                                } catch (e) {
                                    logger.modManager.warn('Failed to remove old unpacked cache:', f, e)
                                }
                            }
                        }
                    } catch (e: any) {
                        logger.modManager.warn('Failed to cleanup old unpacked cache:', e)
                    }
                } catch (e: any) {
                    logger.modManager.warn('Failed to cache unpacked archive:', e)
                }
            }
        }

        const lowerPath = pathname.toLowerCase()
        let zipBuffer: Buffer

        if (lowerPath.endsWith('.zst') || lowerPath.endsWith('.zstd')) {
            zipBuffer = (await zstdDecompressAsync(rawArchive as any)) as Buffer
        } else if (lowerPath.endsWith('.gz')) {
            zipBuffer = await gunzipAsync(rawArchive)
        } else {
            zipBuffer = rawArchive as Buffer
        }

        extractZipBuffer(zipBuffer, tempExtractPath)

        const extractedRoot = resolveExtractedRoot(tempExtractPath, targetPath)

        fs.rmSync(targetPath, { recursive: true, force: true })
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })

        try {
            fs.renameSync(extractedRoot, targetPath)

            if (extractedRoot !== tempExtractPath) {
                fs.rmSync(tempExtractPath, { recursive: true, force: true })
            }
        } catch (err: any) {
            if (err?.code !== 'EXDEV') {
                logger.modManager.error('Failed to move unpacked dir:', err)
                sendFailure(window, { error: err?.message || 'Ошибка при перемещении зависимостей мода', type: 'download_unpacked_error' })
                return false
            }

            try {
                fs.cpSync(extractedRoot, targetPath, { recursive: true })
                fs.rmSync(tempExtractPath, { recursive: true, force: true })
            } catch (copyErr: any) {
                logger.modManager.error('Failed to copy unpacked dir:', copyErr)
                sendFailure(window, { error: copyErr?.message || 'Ошибка при копировании зависимостей мода', type: 'download_unpacked_error' })
                return false
            }
        }

        if (checksum) {
            writeUnpackedMarker(targetPath, checksum)
        }

        resetProgress(window)
        return true
    } catch (err: any) {
        logger.modManager.error('Failed to download/extract unpacked:', err)
        sendFailure(window, { error: err?.message || 'Ошибка при загрузке зависимостей мода', type: 'download_unpacked_error' })
        return false
    } finally {
        unlinkIfExists(tempArchivePath)
        fs.rmSync(tempExtractPath, { recursive: true, force: true })
    }
}
