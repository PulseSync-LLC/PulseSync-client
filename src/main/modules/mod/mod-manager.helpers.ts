import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import os from 'os'
import RendererEvents, { RendererEvent } from '../../../common/types/rendererEvents'
import { getState } from '../state'
import logger from '../logger'
import { closeYandexMusic, getInstalledYmMetadata, getYandexMusicProcesses, isYandexMusicRunning, launchYandexMusic } from '../../utils/appUtils'
import { Paths } from './mod-files'
import { downloadAndUpdateFile, prepareAndInstallAsarArtifact } from './network'
import { nativeDeleteFile, nativeFileExists } from '../nativeModules'
import { resetProgress, sendProgress, sendToRenderer, setProgress } from './download.helpers'
import { CACHE_DIR } from '../../constants/paths'
import { t } from '../../i18n'
import type { RemoteModInfo } from './network/modCatalog'
import { hashArtifactInWorker } from './network/artifactWorkerClient'

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

export async function closeMusicIfRunning(window: BrowserWindow | null | undefined): Promise<boolean> {
    if (await isYandexMusicRunning()) {
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
    onFailure?: (failure: { error: string; type: string }) => void,
): Promise<boolean> {
    if (fileExists(cacheFile)) {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.usingCache') })
        try {
            logger.modManager.info(`Using cached app.asar from ${cacheFile}`)
            const progressBase = progress?.base ?? 0
            const progressScale = progress?.scale ?? 1
            const processingProgress = progressBase + progressScale * 0.85
            setProgress(window, processingProgress)
            sendProgress(window, Math.round(processingProgress * 100), 'app.asar')
            const preparedFilePath = `${tempFilePath}.prepared.${process.pid}.${Date.now()}.asar`
            const ok = await prepareAndInstallAsarArtifact(cacheFile, preparedFilePath, link, paths.modAsar, paths.backupAsar, checksum)
            if (ok) {
                const completedProgress = progressBase + progressScale
                setProgress(window, completedProgress)
                sendProgress(window, Math.round(completedProgress * 100), 'app.asar')
                logger.modManager.info('Successfully restored app.asar from cache')
                return true
            }
            logger.modManager.warn('Failed to apply cached file, redownloading')
        } catch (e: any) {
            logger.modManager.warn('Failed to use cache, redownloading:', e)
            resetProgress(window)
        }
    }
    return await downloadAndUpdateFile(
        window,
        link,
        tempFilePath,
        paths.modAsar,
        paths.backupAsar,
        checksum,
        cacheDir,
        progress,
        'app.asar',
        onFailure,
    )
}

export async function readChecksum(filePath: string): Promise<string | null> {
    try {
        const startedAt = Date.now()
        const result = await hashArtifactInWorker({ filePath })
        logger.modManager.info('Hashed artifact in worker', {
            totalMs: Date.now() - startedAt,
            workerThreadId: result.workerThreadId,
            checksum: result.durationMs,
        })
        return result.checksum
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

export async function persistInstalledModState(paths: Paths, matchedMod: RemoteModInfo, resolvedChecksum: string): Promise<void> {
    const ymMetadata = await getInstalledYmMetadata()
    const prevMod = (State.get('mod') as Record<string, unknown> | undefined) ?? {}

    State.set('mod', {
        ...prevMod,
        version: matchedMod.modVersion,
        musicVersion: ymMetadata?.version ?? matchedMod.musicVersion,
        realMusicVersion: matchedMod.realMusicVersion,
        name: matchedMod.name,
        installed: true,
        checksum: resolvedChecksum,
        unpackedChecksum: '',
    })

    const targetMusicVersion = matchedMod.realMusicVersion || matchedMod.musicVersion
    if (!targetMusicVersion) return

    const versionFilePath = path.join(paths.music, 'version.bin')
    const tempVersionFilePath = path.join(os.tmpdir(), `pulsesync-version.${Date.now()}.${process.pid}.bin`)
    await fs.promises.writeFile(tempVersionFilePath, targetMusicVersion)
    try {
        await fs.promises.copyFile(tempVersionFilePath, versionFilePath)
    } finally {
        try {
            await fs.promises.unlink(tempVersionFilePath)
        } catch {}
    }
}

export function setProgressPercent(window: BrowserWindow, progressBase: number, name: string): void {
    setProgress(window, progressBase)
    sendProgress(window, Math.round(progressBase * 100), name)
}

export async function sendSuccessAfterLaunch(
    window: BrowserWindow | null | undefined,
    wasClosed: boolean,
    channel: RendererEvent,
    payload: { success: true },
): Promise<boolean> {
    sendToRenderer(window, channel, payload)
    resetProgress(window)

    if (!wasClosed) return false

    void (async () => {
        try {
            if (!(await isYandexMusicRunning())) {
                await launchYandexMusic()
            }
        } catch (error) {
            logger.modManager.warn('Failed to relaunch Yandex Music after mod operation:', error)
        }
    })()
    return true
}
