import { BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { getState } from '../state'
import logger from '../logger'
import {
    copyFile,
    downloadYandexMusic,
    getInstalledYmMetadata,
    isMac,
    isWindows,
} from '../../utils/appUtils'
import {
    ensureBackup,
    ensureLinuxModPath,
    resolveBasePaths,
    restoreMacIntegrity,
    restoreWindowsIntegrity,
} from './mod-files'
import { checkModCompatibility, downloadAndExtractUnpacked, downloadAndUpdateFile } from './mod-network'
import { nativeRenameFile } from '../nativeModules'
import { resetProgress, sendFailure, sendToRenderer } from './download.helpers'
import { CACHE_DIR, TEMP_DIR } from '../../constants/paths'
import { t } from '../../i18n'
import {
    clearCacheOnVersionChange,
    cleanupModArtifacts,
    clearModState,
    closeMusicIfRunning,
    fileExists,
    readChecksum,
    sendSuccessAfterLaunch,
    setProgressPercent,
    tryUseCacheOrDownload,
} from './mod-manager.helpers'

const State = getState()
const PROGRESS_ASAR_ONLY = { base: 0, scale: 1, resetOnComplete: true }
const PROGRESS_ASAR_WITH_UNPACKED = { base: 0, scale: 0.6, resetOnComplete: false }
const PROGRESS_UNPACKED = { base: 0.6, scale: 0.4, resetOnComplete: true }
clearCacheOnVersionChange()

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

                const paths = await ensureLinuxModPath(await resolveBasePaths())

                const wasClosed = await closeMusicIfRunning(window)

                const ymMetadata = await getInstalledYmMetadata()
                if (!force && !spoof) {
                    const comp = await checkModCompatibility(version, ymMetadata?.version)
                    if (!comp.success) {
                        const type =
                            comp.code === 'YANDEX_VERSION_OUTDATED'
                                ? 'version_outdated'
                                : comp.code === 'YANDEX_VERSION_TOO_NEW'
                                  ? 'version_too_new'
                                  : 'unknown'
                        return sendFailure(window, {
                            error: comp.message || t('main.modManager.incompatibleMod'),
                            type,
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
                        await copyFile(paths.modAsar, paths.modAsar)
                        await copyFile(paths.infoPlist, paths.infoPlist)
                    } catch {
                        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles')
                        return sendFailure(window, { error: t('main.modManager.fullDiskAccessRequired'), type: 'file_copy_error' })
                    }
                }

                const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')

                const hasUnpacked = Boolean(unpackLink)
                const asarProgress = hasUnpacked ? PROGRESS_ASAR_WITH_UNPACKED : PROGRESS_ASAR_ONLY
                const unpackedProgress = hasUnpacked ? PROGRESS_UNPACKED : undefined

                if (checksum) {
                    const cacheFile = path.join(CACHE_DIR, `${checksum}.asar`)
                    await fs.promises.mkdir(CACHE_DIR, { recursive: true }).catch(err => {
                        logger.modManager.warn('Failed to create cache dir:', err)
                    })

                    const currentHash = fileExists(paths.modAsar) ? readChecksum(paths.modAsar) : null
                    if (currentHash === checksum) {
                        logger.modManager.info('app.asar hash matches, skipping download')
                        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.modAlreadyInstalled') })
                        if (hasUnpacked) {
                            setProgressPercent(window, PROGRESS_UNPACKED.base)
                        } else {
                            resetProgress(window)
                        }
                    } else if (
                        !(await tryUseCacheOrDownload(window, cacheFile, tempFilePath, link, paths, checksum, CACHE_DIR, asarProgress))
                    ) {
                        return
                    }
                } else {
                    if (
                        !(await downloadAndUpdateFile(
                            window,
                            link,
                            tempFilePath,
                            paths.modAsar,
                            paths.backupAsar,
                            checksum,
                            CACHE_DIR,
                            asarProgress,
                        ))
                    ) {
                        return
                    }
                }

                if (unpackLink) {
                    setProgressPercent(window, PROGRESS_UNPACKED.base)

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
                        unpackedProgress,
                    )
                    if (!unpackedOk) return
                }

                const actualAsarChecksum = readChecksum(paths.modAsar) ?? checksum
                if (actualAsarChecksum) {
                    logger.modManager.info('Calculated actual asar checksum:', actualAsarChecksum)
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

                const versionFilePath = path.join(paths.music, 'version.bin')
                await fs.promises.writeFile(versionFilePath, musicVersion)

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

            const backupExists = fileExists(paths.backupAsar)

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

            await cleanupModArtifacts(paths)

            await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.REMOVE_MOD_SUCCESS, { success: true })
        } catch (error: any) {
            logger.modManager.error('Failed to remove mod:', error)
            sendToRenderer(window, RendererEvents.REMOVE_MOD_FAILURE, { success: false, error: error.message, type: 'remove_mod_error' })
        }
    })
    ipcMain.on(MainEvents.CLEAR_MOD_CACHE, async () => {
        try {
            await fs.promises.rm(CACHE_DIR, { recursive: true, force: true })
            sendToRenderer(window, RendererEvents.CLEAR_MOD_CACHE_SUCCESS, { success: true })
        } catch (error: any) {
            logger.modManager.error('Failed to clear mod cache:', error)
            sendToRenderer(window, RendererEvents.CLEAR_MOD_CACHE_FAILURE, {
                success: false,
                error: error?.message || 'Failed to clear mod cache',
            })
        }
    })
}
