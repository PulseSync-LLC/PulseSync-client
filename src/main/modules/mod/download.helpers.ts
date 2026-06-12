import { BrowserWindow } from 'electron'
import * as fs from 'original-fs'
import axios from 'axios'
import * as https from 'https'
import crypto from 'crypto'
import { Readable, Transform, pipeline as nodePipeline } from 'stream'
import { promisify } from 'util'
import RendererEvents, { RendererEvent } from '../../../common/types/rendererEvents'
import { t } from '../../i18n'
import logger from '../logger'

const pipeline = promisify(nodePipeline)
const DOWNLOAD_REQUEST_TIMEOUT_MS = 30_000
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 30_000

export function sendToRenderer(window: BrowserWindow | null | undefined, channel: RendererEvent, payload: any) {
    window?.webContents.send(channel, payload)
}

export function setProgress(window: BrowserWindow | null | undefined, frac: number) {
    window?.setProgressBar(frac)
}

export function resetProgress(window: BrowserWindow | null | undefined) {
    setProgress(window, -1)
}

export function sendProgress(window: BrowserWindow | null | undefined, progress: number, name: string) {
    sendToRenderer(window, RendererEvents.DOWNLOAD_PROGRESS, { progress, name })
}

export function sendFailure(
    window: BrowserWindow,
    params: { error: string; type?: string; url?: string; requiredVersion?: string; recommendedVersion?: string },
) {
    sendToRenderer(window, RendererEvents.DOWNLOAD_FAILURE, { success: false, ...params })
    resetProgress(window)
}

export function unlinkIfExists(p: string) {
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {}
}

export function restoreBackupIfExists(savePath: string, backupPath: string) {
    try {
        if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, savePath)
    } catch {}
}

export class DownloadError extends Error {
    constructor(
        message: string,
        public code: 'network' | 'checksum_mismatch' | 'writer_error' | 'unknown' = 'unknown',
    ) {
        super(message)
    }
}

export async function downloadToTempWithProgress(args: {
    window: BrowserWindow
    url: string
    tempFilePath: string
    expectedChecksum?: string
    progressScale?: number
    progressBase?: number
    userAgent: string
    rejectUnauthorized?: boolean
    name: string
}): Promise<{ totalBytes: number; computedHash?: string }> {
    const { window, url, tempFilePath, expectedChecksum, progressScale = 0.6, progressBase = 0, userAgent, rejectUnauthorized = true, name } = args
    const startedAt = Date.now()
    const downloadHost = (() => {
        try {
            return new URL(url).host
        } catch {
            return 'unknown-host'
        }
    })()

    const headers: Record<string, string> = {
        'User-Agent': userAgent,
        Accept: 'application/octet-stream',
    }
    const httpsAgent = new https.Agent({ rejectUnauthorized })
    let downloaded = 0
    const hasher = expectedChecksum ? crypto.createHash('sha256') : null
    let inactivityTimer: NodeJS.Timeout | null = null
    let responseStream: Readable | null = null

    const clearInactivityTimer = () => {
        if (!inactivityTimer) return
        clearTimeout(inactivityTimer)
        inactivityTimer = null
    }

    const resetInactivityTimer = () => {
        clearInactivityTimer()
        inactivityTimer = setTimeout(() => {
            const error = new DownloadError(t('main.modDownload.networkError'), 'network')
            responseStream?.destroy(error)
        }, DOWNLOAD_INACTIVITY_TIMEOUT_MS)
    }

    logger.modManager.info(`Starting ${name} download from ${downloadHost}`)

    try {
        const response = await axios.get(url, {
            httpsAgent,
            responseType: 'stream',
            headers,
            timeout: DOWNLOAD_REQUEST_TIMEOUT_MS,
        })

        const total = Number(response.headers['content-length'] || 0)
        responseStream = response.data as Readable

        const progressTap = new Transform({
            transform(chunk, _enc, cb) {
                resetInactivityTimer()
                downloaded += chunk.length
                if (total > 0) {
                    const frac = downloaded / total
                    const scaled = Math.min(frac * progressScale, progressScale)
                    const combined = Math.min(progressBase + scaled, progressBase + progressScale)
                    setProgress(window, combined)
                    sendProgress(window, Math.round(Math.min(progressBase + Math.min(frac, 1) * progressScale, 1) * 100), name)
                }
                if (hasher) hasher.update(chunk)
                this.push(chunk)
                cb()
            },
        })

        const writer = fs.createWriteStream(tempFilePath)
        resetInactivityTimer()
        await pipeline(response.data, progressTap, writer)
    } catch (error: any) {
        logger.modManager.warn(`${name} download failed from ${downloadHost}`, {
            bytes: downloaded,
            durationMs: Date.now() - startedAt,
            code: error?.code,
            message: error?.message,
        })
        if (error instanceof DownloadError) throw error
        throw new DownloadError(error?.message || t('main.modDownload.networkError'), 'network')
    } finally {
        clearInactivityTimer()
    }

    logger.modManager.info(`Completed ${name} download from ${downloadHost}`, {
        bytes: downloaded,
        durationMs: Date.now() - startedAt,
    })

    let digest: string | undefined
    if (expectedChecksum && hasher) {
        digest = hasher.digest('hex')
        if (digest !== expectedChecksum) {
            console.error(`[CHECKSUM ERROR] Expected: ${expectedChecksum}, Got: ${digest}, Size: ${downloaded} bytes, URL: ${url}`)
            unlinkIfExists(tempFilePath)
            throw new DownloadError(
                `checksum mismatch (expected: ${expectedChecksum.substring(0, 8)}..., got: ${digest?.substring(0, 8)}...)`,
                'checksum_mismatch',
            )
        }
    }

    return { totalBytes: downloaded, computedHash: digest }
}
