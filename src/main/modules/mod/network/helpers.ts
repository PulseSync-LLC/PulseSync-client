import * as fs from 'original-fs'
import * as path from 'path'
import crypto from 'crypto'
import AdmZip from 'adm-zip'
import logger from '../../logger'
import { gunzipAsync, zstdDecompressAsync } from '../mod-files'
import type { ReplaceDirFailure, ReplaceDirResult, RetryStageFailure, RetryStageResult } from './types'

export const UNPACKED_MARKER_FILE = '.pulsesync_unpacked_checksum'

const REPLACE_RECOVERABLE_CODES = new Set(['EXDEV', 'EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'])

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function sha256Hex(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex')
}

export async function ensureDir(dir: string): Promise<void> {
    try {
        await fs.promises.mkdir(dir, { recursive: true })
    } catch (err) {
        logger.modManager.warn('Failed to create cache dir:', err)
    }
}

export async function pruneCacheFiles(cacheDir: string, keepFile: string, matcher: (file: string) => boolean, warnLabel: string) {
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

export function readCachedArchive(cacheFile: string, checksum?: string): Buffer | null {
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

export async function decompressArchive(rawArchive: Buffer, extLower: string): Promise<Buffer> {
    if (extLower === '.zst' || extLower === '.zstd') {
        return (await zstdDecompressAsync(rawArchive as any)) as Buffer
    }
    if (extLower === '.gz') {
        return await gunzipAsync(rawArchive)
    }
    return rawArchive
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

export function extractZipBuffer(zipBuffer: Buffer, destination: string): void {
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
    } catch {
        throw new Error('Failed to extract ZIP archive')
    }
}

export function resolveExtractedRoot(extractDir: string, targetPath: string): string {
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

export function readUnpackedMarker(targetPath: string): string | null {
    try {
        const markerPath = path.join(targetPath, UNPACKED_MARKER_FILE)
        if (!fs.existsSync(markerPath)) return null
        const v = fs.readFileSync(markerPath, 'utf8').trim()
        return v || null
    } catch {
        return null
    }
}

export function writeUnpackedMarker(targetPath: string, checksum: string): void {
    try {
        const markerPath = path.join(targetPath, UNPACKED_MARKER_FILE)
        fs.writeFileSync(markerPath, `${checksum}\n`, 'utf8')
    } catch (e) {
        logger.modManager.warn('Failed to write unpacked marker:', e)
    }
}

function cleanupTempExtractPath(sourceDir: string, tempExtractPath: string): void {
    if (sourceDir === tempExtractPath) return
    fs.rmSync(tempExtractPath, { recursive: true, force: true })
}

function isRetryStageFailure(result: RetryStageResult): result is RetryStageFailure {
    return result.success === false
}

export function isReplaceDirFailure(result: ReplaceDirResult): result is ReplaceDirFailure {
    return result.ok === false
}

async function runReplaceStageWithRetries(
    runStage: () => void,
    maxAttempts: number,
    retryDelayStepMs: number,
): Promise<RetryStageResult> {
    let lastErr: any
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            runStage()
            return { success: true }
        } catch (err: any) {
            lastErr = err
            const recoverable = REPLACE_RECOVERABLE_CODES.has(err?.code)
            if (!recoverable) {
                return { success: false, error: err, recoverable: false }
            }
            if (attempt < maxAttempts) {
                await sleep(retryDelayStepMs * attempt)
            }
        }
    }
    return { success: false, error: lastErr, recoverable: true }
}

export async function tryReplaceDir(sourceDir: string, targetDir: string, tempExtractPath: string): Promise<ReplaceDirResult> {
    const maxAttempts = process.platform === 'win32' ? 5 : 2

    const moveResult = await runReplaceStageWithRetries(() => {
        fs.rmSync(targetDir, { recursive: true, force: true })
        fs.renameSync(sourceDir, targetDir)
    }, maxAttempts, 120)

    if (!isRetryStageFailure(moveResult)) {
        cleanupTempExtractPath(sourceDir, tempExtractPath)
        return { ok: true }
    }
    if (!moveResult.recoverable) {
        return { ok: false, error: moveResult.error, stage: 'move' }
    }

    const copyResult = await runReplaceStageWithRetries(() => {
        fs.rmSync(targetDir, { recursive: true, force: true })
        fs.cpSync(sourceDir, targetDir, { recursive: true, force: true })
    }, maxAttempts, 150)

    if (!isRetryStageFailure(copyResult)) {
        fs.rmSync(tempExtractPath, { recursive: true, force: true })
        return { ok: true }
    }

    return { ok: false, error: copyResult.error, stage: 'copy' }
}
