import { BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import * as fs from 'original-fs'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { getState } from '../state'
import logger from '../logger'
import { copyFile, downloadYandexMusic, getInstalledYmMetadata, isLinux, isMac, isWindows } from '../../utils/appUtils'
import { ensureBackup, ensureLinuxModPath, resolveBasePaths, restoreMacIntegrity, restoreWindowsIntegrity } from './mod-files'
import { downloadAndExtractUnpacked, downloadAndUpdateFile } from './network'
import { nativeRenameFile } from '../nativeModules'
import { resetProgress, sendFailure, sendToRenderer } from './download.helpers'
import { CACHE_DIR, TEMP_DIR } from '../../constants/paths'
import { t } from '../../i18n'
import { formatPkexecError, grantLinuxOwnershipWithPkexec, isLinuxAccessError } from '../../utils/appUtils/elevation'
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
import { getGithubModRelease } from './network/releaseCatalog'
import type { ModDownloadFailure } from './network/types'

const State = getState()
const PROGRESS_ASAR_ONLY = { base: 0, scale: 1, resetOnComplete: true }
const PROGRESS_ASAR_WITH_UNPACKED = { base: 0, scale: 0.6, resetOnComplete: false }
const PROGRESS_UNPACKED = { base: 0.6, scale: 0.4, resetOnComplete: true }
const MOD_DOWNLOAD_FALLBACK_TYPES = new Set(['download_error', 'download_unpacked_error', 'checksum_mismatch'])

const isFallbackEligibleDownloadFailure = (failure: ModDownloadFailure | null): failure is ModDownloadFailure =>
    Boolean(failure && MOD_DOWNLOAD_FALLBACK_TYPES.has(failure.type))

clearCacheOnVersionChange()

export const modManager = (window: BrowserWindow): void => {
    ipcMain.handle(MainEvents.FIX_LINUX_MUSIC_PERMISSIONS, async () => {
        if (!isLinux()) {
            return { success: false, error: 'Linux only' }
        }
        try {
            const paths = await ensureLinuxModPath(await resolveBasePaths())
            const targets = Array.from(new Set([paths.music, path.dirname(paths.modAsar)].filter(Boolean))).map(target => path.resolve(target))
            const forbiddenTargets = new Set(['/', '/opt', '/home'])
            for (const target of targets) {
                if (forbiddenTargets.has(target)) {
                    throw new Error(`Refusing to change ownership for unsafe path: ${target}`)
                }
                await grantLinuxOwnershipWithPkexec(target)
            }
            return { success: true, targets }
        } catch (error: any) {
            logger.modManager.error('Failed to fix Linux permissions:', error)
            return {
                success: false,
                error: formatPkexecError(error),
            }
        }
    })

    ipcMain.on(
        MainEvents.INSTALL_MOD,
        async (_event, { version, musicVersion, name, link, unpackLink, unpackedChecksum, checksum, shouldReinstall, source }) => {
            try {
                const installSource = source === 'github' ? 'github' : 'backend'

                if (shouldReinstall && !State.get('settings.musicReinstalled') && isWindows()) {
                    State.set('settings', { musicReinstalled: true })
                    await downloadYandexMusic('reinstall')
                    return
                }

                const paths = await ensureLinuxModPath(await resolveBasePaths())

                const wasClosed = await closeMusicIfRunning(window)

                const ymMetadata = await getInstalledYmMetadata()
                const resolvedMusicVersion = ymMetadata?.version ?? musicVersion

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
                    if (isLinuxAccessError(e)) {
                        sendFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' })
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
                        window.webContents.send(RendererEvents.REQUEST_MAC_PERMISSIONS)
                        return sendFailure(window, { error: t('main.modManager.fullDiskAccessRequired'), type: 'file_copy_error' })
                    }
                }

                const applyReleaseArtifacts = async (
                    releaseData: {
                        checksum?: string
                        link: string
                        name: string
                        unpackLink?: string
                        unpackedChecksum?: string
                        version: string
                    },
                    onFailure?: (failure: ModDownloadFailure) => void,
                ): Promise<boolean> => {
                    const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')
                    const hasUnpacked = Boolean(releaseData.unpackLink)
                    const asarProgress = hasUnpacked ? PROGRESS_ASAR_WITH_UNPACKED : PROGRESS_ASAR_ONLY
                    const unpackedProgress = hasUnpacked ? PROGRESS_UNPACKED : undefined

                    if (releaseData.checksum) {
                        const cacheFile = path.join(CACHE_DIR, `${releaseData.checksum}.asar`)
                        await fs.promises.mkdir(CACHE_DIR, { recursive: true }).catch(err => {
                            logger.modManager.warn('Failed to create cache dir:', err)
                        })

                        const currentHash = fileExists(paths.modAsar) ? readChecksum(paths.modAsar) : null
                        if (currentHash === releaseData.checksum) {
                            logger.modManager.info('app.asar hash matches, skipping download')
                            sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.modAlreadyInstalled') })
                            if (hasUnpacked) {
                                setProgressPercent(window, PROGRESS_UNPACKED.base, 'app.asar.unpacked')
                            } else {
                                resetProgress(window)
                            }
                        } else if (
                            !(await tryUseCacheOrDownload(
                                window,
                                cacheFile,
                                tempFilePath,
                                releaseData.link,
                                paths,
                                releaseData.checksum,
                                CACHE_DIR,
                                asarProgress,
                                onFailure,
                            ))
                        ) {
                            return false
                        }
                    } else {
                        if (
                            !(await downloadAndUpdateFile(
                                window,
                                releaseData.link,
                                tempFilePath,
                                paths.modAsar,
                                paths.backupAsar,
                                releaseData.checksum,
                                CACHE_DIR,
                                asarProgress,
                                'app.asar',
                                onFailure,
                            ))
                        ) {
                            return false
                        }
                    }

                    if (releaseData.unpackLink) {
                        setProgressPercent(window, PROGRESS_UNPACKED.base, 'app.asar.unpacked')

                        const unpackName = path.basename(new URL(releaseData.unpackLink).pathname)
                        const tempUnpackedArchive = path.join(TEMP_DIR, unpackName || 'app.asar.unpacked')
                        const tempUnpackedDir = path.join(TEMP_DIR, 'app.asar.unpacked')
                        const targetUnpackedDir = path.join(path.dirname(paths.modAsar), 'app.asar.unpacked')

                        const unpackedOk = await downloadAndExtractUnpacked(
                            window,
                            releaseData.unpackLink,
                            tempUnpackedArchive,
                            tempUnpackedDir,
                            targetUnpackedDir,
                            releaseData.unpackedChecksum,
                            CACHE_DIR,
                            unpackedProgress,
                            onFailure,
                        )
                        if (!unpackedOk) return false
                    }

                    const actualAsarChecksum = readChecksum(paths.modAsar) ?? releaseData.checksum
                    if (actualAsarChecksum) {
                        logger.modManager.info('Calculated actual asar checksum:', actualAsarChecksum)
                    }

                    State.set('mod', {
                        version: releaseData.version,
                        musicVersion: ymMetadata?.version,
                        realMusicVersion: musicVersion,
                        name: releaseData.name,
                        checksum: actualAsarChecksum,
                        unpackedChecksum: releaseData.unpackedChecksum,
                        installed: true,
                    })

                    return true
                }

                let primaryFailure: ModDownloadFailure | null = null
                const installSucceeded = await applyReleaseArtifacts(
                    {
                        version,
                        name,
                        link,
                        unpackLink,
                        unpackedChecksum,
                        checksum,
                    },
                    installSource === 'backend'
                        ? failure => {
                              primaryFailure = failure
                          }
                        : undefined,
                )

                if (!installSucceeded) {
                    if (installSource === 'backend' && isFallbackEligibleDownloadFailure(primaryFailure)) {
                        const backendFailure = primaryFailure
                        try {
                            logger.modManager.warn('Backend mod download failed, trying GitHub fallback', backendFailure)
                            const fallbackRelease = await getGithubModRelease()
                            let fallbackFailure: ModDownloadFailure | null = null

                            if (!fallbackRelease?.downloadUrl) {
                                sendFailure(window, backendFailure)
                                return
                            }

                            if (
                                !(await applyReleaseArtifacts(
                                    {
                                        version: fallbackRelease.modVersion,
                                        name: fallbackRelease.name,
                                        link: fallbackRelease.downloadUrl,
                                        unpackLink: fallbackRelease.downloadUnpackedUrl || undefined,
                                        unpackedChecksum: fallbackRelease.unpackedChecksum || undefined,
                                        checksum: fallbackRelease.checksum_v2 || undefined,
                                    },
                                    failure => {
                                        fallbackFailure = failure
                                    },
                                ))
                            ) {
                                sendFailure(window, fallbackFailure ?? backendFailure)
                                return
                            }
                        } catch (fallbackError) {
                            logger.modManager.error('GitHub fallback for mod update failed', fallbackError)
                            sendFailure(window, backendFailure)
                            return
                        }
                    } else {
                        if (primaryFailure) {
                            sendFailure(window, primaryFailure)
                        }
                        return
                    }
                }

                const versionFilePath = path.join(paths.music, 'version.bin')
                const tempVersionFilePath = path.join(TEMP_DIR, `version.${Date.now()}.${process.pid}.bin`)
                if (resolvedMusicVersion) {
                    await fs.promises.writeFile(tempVersionFilePath, resolvedMusicVersion)
                    try {
                        await copyFile(tempVersionFilePath, versionFilePath)
                    } finally {
                        try {
                            await fs.promises.unlink(tempVersionFilePath)
                        } catch {}
                    }
                } else {
                    logger.modManager.warn('Skipping version.bin update because no Yandex Music version was resolved')
                }

                if (await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.DOWNLOAD_SUCCESS, { success: true })) return
            } catch (error: any) {
                logger.modManager.error('Unexpected error:', error)
                if (isLinuxAccessError(error)) {
                    sendFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' })
                    return
                }
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
            if (isLinuxAccessError(error)) {
                sendToRenderer(window, RendererEvents.REMOVE_MOD_FAILURE, {
                    success: false,
                    error: t('main.modManager.linuxPermissionsRequired'),
                    type: 'linux_permissions_required',
                })
                return
            }
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
