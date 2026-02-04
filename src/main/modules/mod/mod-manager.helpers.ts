import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import crypto from 'crypto'
import RendererEvents, { RendererEvent } from '../../../common/types/rendererEvents'
import { getState } from '../state'
import logger from '../logger'
import { closeYandexMusic, copyFile, isYandexMusicRunning, launchYandexMusic } from '../../utils/appUtils'
import { Paths, writePatchedAsarAndPatchBundle } from './mod-files'
import { downloadAndUpdateFile } from './mod-network'
import { nativeDeleteFile, nativeFileExists } from '../nativeModules'
import { resetProgress, sendProgress, sendToRenderer, setProgress } from './download.helpers'
import { CACHE_DIR } from '../../constants/paths'
import { t } from '../../i18n'

const State = getState()

export const fileExists = (filePath: string) => nativeFileExists(filePath) || fs.existsSync(filePath)

export function clearCacheOnVersionChange(): void {
    try {
        const currentVersion = app.getVersion()
        const savedVersion = State.get('app.version')
        if (savedVersion !== currentVersion) {
            try {
                if (fs.existsSync(CACHE_DIR)) {
                    logger.modManager.info(`App version changed (${savedVersion} -> ${currentVersion}), clearing mod cache`)
                    fs.rmSync(CACHE_DIR, { recursive: true, force: true })
                }
            } catch (err: any) {
                logger.modManager.warn('Failed to clear mod cache on version change:', err)
            }
            State.set('app.version', currentVersion)
        }
    } catch (err: any) {
        logger.modManager.warn('Failed to check/clear mod cache on startup:', err)
    }
}

export async function closeMusicIfRunning(window: BrowserWindow): Promise<boolean> {
    const procs = await isYandexMusicRunning()
    if (procs && procs.length > 0) {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.closingMusic') })
        await closeYandexMusic()
        await new Promise(r => setTimeout(r, 500))
        return true
    }
    return false
}

export async function tryUseCacheOrDownload(
    window: BrowserWindow,
    cacheFile: string,
    tempFilePath: string,
    link: string,
    paths: Paths,
    checksum: string,
    cacheDir: string,
    progress?: { base?: number; scale?: number; resetOnComplete?: boolean },
): Promise<boolean> {
    if (fileExists(cacheFile)) {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.usingCache') })
        try {
            logger.modManager.info(`Using cached app.asar from ${cacheFile}`)
            await copyFile(cacheFile, tempFilePath)
            const fileBuffer = fs.readFileSync(tempFilePath)
            const ok = await writePatchedAsarAndPatchBundle(paths.modAsar, fileBuffer, link, paths.backupAsar, checksum)
            if (ok) {
                logger.modManager.info('Successfully restored app.asar from cache')
                return true
            }
            logger.modManager.warn('Failed to apply cached file, redownloading')
        } catch (e: any) {
            logger.modManager.warn('Failed to use cache, redownloading:', e)
            resetProgress(window)
        }
    }
    return await downloadAndUpdateFile(window, link, tempFilePath, paths.modAsar, paths.backupAsar, checksum, cacheDir, progress)
}

export function readChecksum(filePath: string): string | null {
    try {
        const buf = fs.readFileSync(filePath)
        return crypto.createHash('sha256').update(buf).digest('hex')
    } catch (err: any) {
        logger.modManager.warn('Failed to verify existing file:', err)
        return null
    }
}

export function clearModState(): void {
    State.delete('mod.version')
    State.delete('mod.musicVersion')
    State.delete('mod.name')
    State.delete('mod.checksum')
    State.delete('mod.unpackedChecksum')
    State.set('mod.installed', false)
}

export async function cleanupModArtifacts(paths: Paths): Promise<void> {
    const versionFilePath = path.join(paths.music, 'version.bin')
    try {
        await fs.promises.rm(versionFilePath, { force: true })
    } catch (e) {
        logger.modManager.warn('Failed to delete version file:', e)
    }

    const unpackedDir = path.join(path.dirname(paths.modAsar), 'app.asar.unpacked')
    try {
        if (fs.existsSync(unpackedDir)) {
            nativeDeleteFile(unpackedDir)
        }
    } catch (e) {
        logger.modManager.warn('Failed to delete unpacked dir:', e)
    }
}

export function setProgressPercent(window: BrowserWindow, progressBase: number): void {
    setProgress(window, progressBase)
    sendProgress(window, Math.round(progressBase * 100))
}

export async function sendSuccessAfterLaunch(
    window: BrowserWindow,
    wasClosed: boolean,
    channel: RendererEvent,
    payload: { success: true },
): Promise<boolean> {
    if (!(await isYandexMusicRunning()) && wasClosed) {
        await launchYandexMusic()
        setTimeout(() => sendToRenderer(window, channel, payload), 1500)
        return true
    }
    sendToRenderer(window, channel, payload)
    return false
}
