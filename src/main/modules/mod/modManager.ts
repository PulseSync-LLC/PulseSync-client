import { BrowserWindow, ipcMain, shell, app } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { deleteFfmpeg, installFfmpeg } from '../../utils/ffmpeg-installer'
import { getState } from '../state'
import logger from '../logger'
import {
    downloadYandexMusic,
    getInstalledYmMetadata,
    isMac,
    isWindows,
    closeYandexMusic,
    isYandexMusicRunning,
    launchYandexMusic,
} from '../../utils/appUtils'
import { ensureBackup, ensureLinuxModPath, resolveBasePaths, restoreMacIntegrity, restoreWindowsIntegrity, Paths } from './mod-files'
import { checkModCompatibility, downloadAndExtractUnpacked, downloadAndUpdateFile } from './mod-network'
import { nativeFileExists, nativeRenameFile } from '../nativeModules'
import { resetProgress, sendFailure, sendToRenderer } from './download.helpers'
import { TEMP_DIR, CACHE_DIR } from '../../constants/paths'

const State = getState()

try {
    const currentVersion = app.getVersion()
    const savedVersion = State.get('app.version')
    if (savedVersion !== currentVersion) {
        try {
            if (fs.existsSync(CACHE_DIR)) {
                logger.modManager.info(`App version changed (${savedVersion} -> ${currentVersion}), clearing mod cache at ${CACHE_DIR}`)
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
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: 'Закрытие Яндекс Музыки...' })
        await closeYandexMusic()
        await new Promise(r => setTimeout(r, 500))
        return true
    }
    return false
}

function mapCompatibilityCodeToType(code?: string): 'version_outdated' | 'version_too_new' | 'unknown' {
    if (code === 'YANDEX_VERSION_OUTDATED') return 'version_outdated'
    if (code === 'YANDEX_VERSION_TOO_NEW') return 'version_too_new'
    return 'unknown'
}

export const modManager = (window: BrowserWindow): void => {
    ipcMain.on(
        MainEvents.UPDATE_MUSIC_ASAR,
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
                            error: comp.message || 'Мод не совместим с текущей версией Яндекс Музыки.',
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
                            error: `${path.basename(paths.modAsar)} не найден. Пожалуйста, переустановите Яндекс Музыку.`,
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
                        return sendFailure(window, { error: 'Пожалуйста, предоставьте приложению полный доступ к диску.', type: 'file_copy_error' })
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

                    if (nativeFileExists(cacheFile) || fs.existsSync(cacheFile)) {
                        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: 'Использование кеша мода...' })
                        try {
                            await fs.promises.copyFile(cacheFile, tempFilePath)
                            await fs.promises.copyFile(tempFilePath, paths.modAsar)

                            State.set('mod', {
                                version,
                                musicVersion: ymMetadata?.version,
                                realMusicVersion: musicVersion,
                                name,
                                checksum,
                                installed: true,
                            })

                            const versionFilePath = path.join(paths.music, 'version')
                            await fs.promises.writeFile(versionFilePath, musicVersion)

                            await installFfmpeg(window)
                            if (!(await isYandexMusicRunning()) && wasClosed) {
                                await launchYandexMusic()
                                return setTimeout(() => sendToRenderer(window, RendererEvents.DOWNLOAD_SUCCESS, { success: true }), 1500)
                            }

                            sendToRenderer(window, RendererEvents.DOWNLOAD_SUCCESS, { success: true })
                            return
                        } catch (e: any) {
                            logger.modManager.warn('Failed to use cache, falling back to download:', e)
                            resetProgress(window)
                        }
                    }
                }

                const ok = await downloadAndUpdateFile(window, link, tempFilePath, paths.modAsar, paths.backupAsar, checksum, CACHE_DIR)
                if (!ok) return

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

                State.set('mod', {
                    version,
                    musicVersion: ymMetadata?.version,
                    realMusicVersion: musicVersion,
                    name,
                    checksum,
                    installed: true,
                })

                const versionFilePath = path.join(paths.music, 'version')
                await fs.promises.writeFile(versionFilePath, musicVersion)

                await installFfmpeg(window)
                if (!(await isYandexMusicRunning()) && wasClosed) {
                    await launchYandexMusic()
                    return setTimeout(() => sendToRenderer(window, RendererEvents.DOWNLOAD_SUCCESS, { success: true }), 1500)
                }
                sendToRenderer(window, RendererEvents.DOWNLOAD_SUCCESS, { success: true })
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

            State.delete('mod.version')
            State.delete('mod.musicVersion')
            State.delete('mod.name')
            State.set('mod.installed', false)

            const versionFilePath = path.join(paths.music, 'version')
            try {
                if (fs.existsSync(versionFilePath)) {
                    await fs.promises.unlink(versionFilePath)
                }
            } catch (e) {
                logger.modManager.warn('Failed to delete version file:', e)
            }

            await deleteFfmpeg()

            if (!(await isYandexMusicRunning()) && wasClosed) {
                await launchYandexMusic()
                return setTimeout(() => sendToRenderer(window, RendererEvents.REMOVE_MOD_SUCCESS, { success: true }), 1500)
            }
            sendToRenderer(window, RendererEvents.REMOVE_MOD_SUCCESS, { success: true })
        } catch (error: any) {
            logger.modManager.error('Error removing mod:', error)
            sendToRenderer(window, RendererEvents.REMOVE_MOD_FAILURE, { success: false, error: error.message, type: 'remove_mod_error' })
        }
    })
}
