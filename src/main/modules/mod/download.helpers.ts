import { BrowserWindow } from 'electron'
import * as fs from 'original-fs'
import axios from 'axios'
import * as https from 'https'
import crypto from 'crypto'
import { Transform, pipeline as nodePipeline } from 'stream'
import { promisify } from 'util'
import RendererEvents, { RendererEvent } from '../../../common/types/rendererEvents'
import { t } from '../../i18n'

const pipeline = promisify(nodePipeline)

export function sendToRenderer(window: BrowserWindow | null | undefined, channel: RendererEvent, payload: any) {
    window?.webContents.send(channel, payload)
}

export function setProgress(window: BrowserWindow | null | undefined, frac: number) {
    window?.setProgressBar(frac)
}

export function resetProgress(window: BrowserWindow | null | undefined) {
    setProgress(window, -1)
}

export function sendProgress(window: BrowserWindow | null | undefined, progress: number) {
    sendToRenderer(window, RendererEvents.DOWNLOAD_PROGRESS, { progress })
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
        if (fs.existsSync(backupPath)) fs.renameSync(backupPath, savePath)
    } catch {}
}

export class DownloadError extends Error {
    constructor(message: string, public code: 'network' | 'checksum_mismatch' | 'writer_error' | 'unknown' = 'unknown') {
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
}): Promise<{ totalBytes: number; computedHash?: string }> {
    const { window, url, tempFilePath, expectedChecksum, progressScale = 0.6, progressBase = 0, userAgent, rejectUnauthorized = true } = args

    const headers: Record<string, string> = {
        'User-Agent': userAgent,
        Accept: 'application/octet-stream',
    }
    const httpsAgent = new https.Agent({ rejectUnauthorized })

    const response = await axios.get(url, { httpsAgent, responseType: 'stream', headers })

    const total = Number(response.headers['content-length'] || 0)
    let downloaded = 0

    const hasher = expectedChecksum ? crypto.createHash('sha256') : null

    const progressTap = new Transform({
        transform(chunk, _enc, cb) {
            downloaded += chunk.length
            if (total > 0) {
                const frac = downloaded / total
                const scaled = Math.min(frac * progressScale, progressScale)
                const combined = Math.min(progressBase + scaled, progressBase + progressScale)
                setProgress(window, combined)
                sendProgress(window, Math.round(Math.min(progressBase + Math.min(frac, 1) * progressScale, 1) * 100))
            }
            if (hasher) hasher.update(chunk)
            this.push(chunk)
            cb()
        },
    })

    const writer = fs.createWriteStream(tempFilePath)

    try {
        await pipeline(response.data, progressTap, writer)
    } catch (e: any) {
        throw new DownloadError(e?.message || t('main.modDownload.networkError'), 'network')
    }

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
