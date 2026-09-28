import * as fs from 'original-fs'
import * as path from 'path'

import logger from '../../logger'
import { hashArtifactInWorker } from './artifactWorkerClient'

export const UNPACKED_MARKER_FILE = '.pulsesync_unpacked_checksum'

export async function sha256File(filePath: string): Promise<string> {
    return (await hashArtifactInWorker({ filePath })).checksum
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

export async function pruneCacheDirectories(cacheDir: string, keepDirectory: string, matcher: (directory: string) => boolean, warnLabel: string) {
    try {
        const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true })
        const keepName = path.basename(keepDirectory)
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name === keepName || !matcher(entry.name)) continue
            try {
                await fs.promises.rm(path.join(cacheDir, entry.name), { recursive: true, force: true })
            } catch (e) {
                logger.modManager.warn(warnLabel, entry.name, e)
            }
        }
    } catch (e) {
        logger.modManager.warn('Failed to cleanup cache:', e)
    }
}

export async function isCachedArchiveValid(cacheFile: string, checksum?: string): Promise<boolean> {
    try {
        await fs.promises.access(cacheFile, fs.constants.R_OK)
        if (checksum) {
            const cachedHash = await sha256File(cacheFile)
            if (cachedHash !== checksum) {
                logger.modManager.warn('Cached archive hash mismatch, redownloading')
                try {
                    await fs.promises.rm(cacheFile, { force: true })
                } catch {}
                return false
            }
        }
        return true
    } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
            logger.modManager.warn('Failed to validate cached archive, redownloading:', e)
        }
        return false
    }
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
