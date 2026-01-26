import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import crypto from 'crypto'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents, { RendererEvent } from '../../../common/types/rendererEvents'
import { deleteFfmpeg, installFfmpeg } from '../../utils/ffmpeg-installer'
import { getState } from '../state'
import logger from '../logger'
import {
    closeYandexMusic,
    downloadYandexMusic,
    getInstalledYmMetadata,
    isMac,
    isWindows,
    isYandexMusicRunning,
    launchYandexMusic,
} from '../../utils/appUtils'
import {
    ensureBackup,
    ensureLinuxModPath,
    Paths,
    resolveBasePaths,
    restoreMacIntegrity,
    restoreWindowsIntegrity,
    writePatchedAsarAndPatchBundle,
} from './mod-files'
import { checkModCompatibility, downloadAndExtractUnpacked, downloadAndUpdateFile } from './mod-network'
import { nativeDeleteFile, nativeFileExists, nativeRenameFile } from '../nativeModules'
import { resetProgress, sendFailure, sendToRenderer } from './download.helpers'
import { CACHE_DIR, TEMP_DIR } from '../../constants/paths'
import { t } from '../../i18n'

const State = getState()

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

async function closeMusicIfRunning(window: BrowserWindow): Promise<boolean> {
    const procs = await isYandexMusicRunning()
    if (procs && procs.length > 0) {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.closingMusic') })
        await closeYandexMusic()
        await new Promise(r => setTimeout(r, 500))
        return true
    }
    return false
}

async function tryUseCacheOrDownload(
    window: BrowserWindow,
    cacheFile: string,
    tempFilePath: string,
    link: string,
    paths: Paths,
    checksum: string,
    cacheDir: string,
): Promise<boolean> {
    if (nativeFileExists(cacheFile) || fs.existsSync(cacheFile)) {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.usingCache') })
        try {
            logger.modManager.info(`Using cached app.asar from ${cacheFile}`)
            await fs.promises.copyFile(cacheFile, tempFilePath)
            const fileBuffer = fs.readFileSync(tempFilePath)
            const ok = await writePatchedAsarAndPatchBundle(window, paths.modAsar, fileBuffer, link, paths.backupAsar, checksum)
            if (ok) {
                logger.modManager.info('Successfully restored app.asar from cache')
                return true
            } else {
                logger.modManager.warn('Failed to apply cached file, redownloading')
            }
        } catch (e: any) {
            logger.modManager.warn('Failed to use cache, redownloading:', e)
            resetProgress(window)
        }
    }
    return await downloadAndUpdateFile(window, link, tempFilePath, paths.modAsar, paths.backupAsar, checksum, cacheDir)
}

function mapCompatibilityCodeToType(code?: string): 'version_outdated' | 'version_too_new' | 'unknown' {
    if (code === 'YANDEX_VERSION_OUTDATED') return 'version_outdated'
    if (code === 'YANDEX_VERSION_TOO_NEW') return 'version_too_new'
    return 'unknown'
}

function clearModState(): void {
    State.delete('mod.version')
    State.delete('mod.musicVersion')
    State.delete('mod.name')
    State.delete('mod.checksum')
    State.delete('mod.unpackedChecksum')
    State.set('mod.installed', false)
}

async function removeVersionFile(versionFilePath: string): Promise<void> {
    try {
        if (fs.existsSync(versionFilePath)) {
            await fs.promises.unlink(versionFilePath)
        }
    } catch (e) {
        logger.modManager.warn('Failed to delete version file:', e)
    }
}

function removeUnpackedDir(unpackedDir: string): void {
    try {
        if (fs.existsSync(unpackedDir)) {
            nativeDeleteFile(unpackedDir)
        }
    } catch (e) {
        logger.modManager.warn('Failed to delete unpacked dir:', e)
    }
}

async function sendSuccessAfterLaunch(
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

export const modManager = (window: BrowserWindow): void => {
    ipcMain.on(
        MainEvents.INSTALL_MOD,
        async (_event, { version, musicVersion, name, link, unpackLink, unpackedChecksum, checksum, shouldReinstall, force, spoof }) => {
            try {
                if (shouldReinstall && !State.get('settings.musicReinstalled') && isWindows()) {
                    State.set('settings', { musicReinstalled: true })
                    await downloadYandexMusic('reinstall')
                    return
                }

                let paths: Paths = await resolveBasePaths()
                paths = await ensureLinuxModPath(window, paths)

                const wasClosed = await closeMusicIfRunning(window)

                const ymMetadata = await getInstalledYmMetadata()
                if (!force && !spoof) {
                    const comp = await checkModCompatibility(version, ymMetadata?.version)
                    if (!comp.success) {
                        return sendFailure(window, {
                            error: comp.message || t('main.modManager.incompatibleMod'),
                            type: mapCompatibilityCodeToType(comp.code),
                            url: comp.url,
                            requiredVersion: comp.requiredVersion,
                            recommendedVersion: comp.recommendedVersion,
                        })
                    }
                }

                try {
                    await ensureBackup(paths)
                } catch (e: any) {
                    if (e && e.code === 'file_not_found') {
                        sendFailure(window, {
                            error: t('main.modManager.modAsarNotFound', { name: path.basename(paths.modAsar) }),
                            type: 'file_not_found',
                        })
                        await downloadYandexMusic('reinstall')
                        return
                    }
                    sendFailure(window, { error: e?.message || String(e), type: 'backup_error' })
                    return
                }

                if (isMac()) {
                    try {
                        await fs.promises.copyFile(paths.modAsar, paths.modAsar)
                        await fs.promises.copyFile(paths.infoPlist, paths.infoPlist)
                    } catch {
                        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles')
                        return sendFailure(window, { error: t('main.modManager.fullDiskAccessRequired'), type: 'file_copy_error' })
                    }
                }

                const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')

                if (checksum) {
                    const cacheFile = path.join(CACHE_DIR, `${checksum}.asar`)
                    try {
                        await fs.promises.mkdir(CACHE_DIR, { recursive: true })
                    } catch (err) {
                        logger.modManager.warn('Failed to create cache dir:', err)
                    }

                    if (nativeFileExists(paths.modAsar) || fs.existsSync(paths.modAsar)) {
                        try {
                            const buf = fs.readFileSync(paths.modAsar)
                            const currentHash = crypto.createHash('sha256').update(buf).digest('hex')
                            if (currentHash === checksum) {
                                logger.modManager.info('app.asar hash matches, skipping download')
                                sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.modAlreadyInstalled') })
                                resetProgress(window)
                            } else {
                                const ok = await tryUseCacheOrDownload(window, cacheFile, tempFilePath, link, paths, checksum, CACHE_DIR)
                                if (!ok) return
                            }
                        } catch (e: any) {
                            logger.modManager.warn('Failed to verify existing file:', e)
                            const ok = await downloadAndUpdateFile(window, link, tempFilePath, paths.modAsar, paths.backupAsar, checksum, CACHE_DIR)
                            if (!ok) return
                        }
                    } else {
                        const ok = await tryUseCacheOrDownload(window, cacheFile, tempFilePath, link, paths, checksum, CACHE_DIR)
                        if (!ok) return
                    }
                } else {
                    const ok = await downloadAndUpdateFile(window, link, tempFilePath, paths.modAsar, paths.backupAsar, checksum, CACHE_DIR)
                    if (!ok) return
                }

                if (unpackLink) {
                    const unpackName = path.basename(new URL(unpackLink).pathname)
                    const tempUnpackedArchive = path.join(TEMP_DIR, unpackName || 'app.asar.unpacked')
                    const tempUnpackedDir = path.join(TEMP_DIR, 'app.asar.unpacked')
                    const targetUnpackedDir = path.join(path.dirname(paths.modAsar), 'app.asar.unpacked')

                    const unpackedOk = await downloadAndExtractUnpacked(
                        window,
                        unpackLink,
                        tempUnpackedArchive,
                        tempUnpackedDir,
                        targetUnpackedDir,
                        unpackedChecksum,
                        CACHE_DIR,
                    )
                    if (!unpackedOk) return
                }

                let actualAsarChecksum = checksum
                try {
                    const buf = fs.readFileSync(paths.modAsar)
                    actualAsarChecksum = crypto.createHash('sha256').update(buf).digest('hex')
                    logger.modManager.info('Calculated actual asar checksum:', actualAsarChecksum)
                } catch (e: any) {
                    logger.modManager.warn('Failed to calculate asar checksum, using provided checksum:', e)
                }

                State.set('mod', {
                    version,
                    musicVersion: ymMetadata?.version,
                    realMusicVersion: musicVersion,
                    name,
                    checksum: actualAsarChecksum,
                    unpackedChecksum: unpackedChecksum,
                    installed: true,
                })

                const versionFilePath = path.join(paths.music, 'version')
                await fs.promises.writeFile(versionFilePath, musicVersion)

                await installFfmpeg(window)
                if (await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.DOWNLOAD_SUCCESS, { success: true })) return
            } catch (error: any) {
                logger.modManager.error('Unexpected error:', error)
                sendFailure(window, { error: error.message, type: 'unexpected_error' })
            }
        },
    )

    ipcMain.on(MainEvents.REMOVE_MOD, async () => {
        try {
            const paths = await resolveBasePaths()
            const wasClosed = await closeMusicIfRunning(window)

            const backupExists = nativeFileExists(paths.backupAsar) || fs.existsSync(paths.backupAsar)

            if (backupExists) {
                const renamed = nativeRenameFile(paths.backupAsar, paths.modAsar)
                if (!renamed) {
                    fs.renameSync(paths.backupAsar, paths.modAsar)
                }
            } else {
                await downloadYandexMusic('reinstall')
                return
            }

            if (isWindows()) await restoreWindowsIntegrity(paths)
            else if (isMac()) await restoreMacIntegrity(paths)

            clearModState()

            const versionFilePath = path.join(paths.music, 'version')
            await removeVersionFile(versionFilePath)
            const unpackedDir = path.join(path.dirname(paths.modAsar), 'app.asar.unpacked')
            removeUnpackedDir(unpackedDir)

            await deleteFfmpeg()

            await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.REMOVE_MOD_SUCCESS, { success: true })
        } catch (error: any) {
            logger.modManager.error('Failed to remove mod:', error)
            sendToRenderer(window, RendererEvents.REMOVE_MOD_FAILURE, { success: false, error: error.message, type: 'remove_mod_error' })
        }
    })
}
