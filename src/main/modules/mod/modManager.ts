import { ipcMain } from 'electron'

import crypto from 'crypto'
import * as fs from 'original-fs'
import * as path from 'path'

import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { CACHE_DIR, TEMP_DIR } from '../../constants/paths'
import { t } from '../../i18n'
import { copyFile, downloadYandexMusic, getInstalledYmMetadata, isLinux, isMac, isWindows } from '../../utils/appUtils'
import { formatPkexecError, grantLinuxOwnershipWithPkexec, isLinuxAccessError } from '../../utils/appUtils/elevation'
import { HandleErrorsElectron } from '../handlers/handleErrorsElectron'
import logger from '../logger'
import { nativeRenameFile } from '../nativeModules'
import { getState } from '../state'
import { DownloadError, downloadToTempWithProgress, resetProgress, sendFailure, sendToRenderer, unlinkIfExists } from './download.helpers'
import { ensureBackup, ensureLinuxModPath, resolveBasePaths, restoreMacIntegrity, restoreWindowsIntegrity } from './mod-files'
import {
    cleanupModArtifacts,
    clearCacheOnVersionChange,
    clearModState,
    closeMusicIfRunning,
    fileExists,
    readChecksum,
    sendSuccessAfterLaunch,
    setProgressPercent,
    tryUseCacheOrDownload,
} from './mod-manager.helpers'
import { downloadAndExtractUnpacked, downloadAndUpdateFile, prepareAndInstallAsarArtifact } from './network'
import { ensureDir, isCachedArchiveValid, pruneCacheFiles } from './network/helpers'
import { getGithubModRelease } from './network/releaseCatalog'
import { getPulseSyncUserAgent } from './network/userAgent'

import type { ModDownloadFailure } from './network/types'
import type { DesktopInstallModRequest } from '@common/desktopApi/contract'
import type { BrowserWindow } from 'electron'

const State = getState()
const PROGRESS_ASAR_ONLY = { base: 0, scale: 0.95, resetOnComplete: false }
const PROGRESS_ASAR_WITH_UNPACKED = { base: 0, scale: 0.58, resetOnComplete: false }
const PROGRESS_UNPACKED = { base: 0.6, scale: 0.39, resetOnComplete: false }
const MOD_DOWNLOAD_FALLBACK_TYPES = new Set(['download_error', 'download_unpacked_error', 'checksum_mismatch'])

type PreparedModUpdate = {
    asarPath: string
    identity: string
    request: DesktopInstallModRequest
    unpackedPath?: string
}

const getModUpdateIdentity = (request: DesktopInstallModRequest): string =>
    JSON.stringify([
        request.version,
        request.source || 'backend',
        request.channel || 'stable',
        request.branch || '',
        request.commit || '',
        request.link,
        request.checksum || '',
        request.unpackLink || '',
        request.unpackedChecksum || '',
    ])

const getModUpdateCachePaths = (request: DesktopInstallModRequest) => {
    const identityHash = crypto.createHash('sha256').update(getModUpdateIdentity(request)).digest('hex')
    const asarKey = request.checksum || identityHash
    const unpackedExtension = request.unpackLink
        ? (() => {
              try {
                  return path.extname(new URL(request.unpackLink).pathname) || '.zip'
              } catch {
                  return '.zip'
              }
          })()
        : ''
    const unpackedKey = request.unpackedChecksum || identityHash

    return {
        asarPath: path.join(CACHE_DIR, `${asarKey}.asar`),
        unpackedPath: request.unpackLink ? path.join(CACHE_DIR, `${unpackedKey}${unpackedExtension}`) : undefined,
        unpackedExtension,
    }
}

const downloadModUpdateToCache = async (
    window: BrowserWindow,
    request: DesktopInstallModRequest,
    onFailure: (failure: ModDownloadFailure) => void,
): Promise<PreparedModUpdate | null> => {
    const identity = getModUpdateIdentity(request)
    const { asarPath, unpackedPath, unpackedExtension } = getModUpdateCachePaths(request)
    const hasUnpacked = Boolean(request.unpackLink && unpackedPath)
    const tempAsarPath = path.join(TEMP_DIR, `mod-update-${process.pid}-${Date.now()}.asar.download`)
    const tempUnpackedPath = path.join(TEMP_DIR, `mod-update-unpacked-${process.pid}-${Date.now()}${unpackedExtension || '.download'}`)
    let stage: 'asar' | 'unpacked' = 'asar'

    await ensureDir(CACHE_DIR)

    try {
        if (await isCachedArchiveValid(asarPath, request.checksum)) {
            setProgressPercent(window, hasUnpacked ? PROGRESS_ASAR_WITH_UNPACKED.scale : PROGRESS_ASAR_ONLY.scale, 'app.asar')
        } else {
            await downloadToTempWithProgress({
                window,
                url: request.link,
                tempFilePath: tempAsarPath,
                expectedChecksum: request.checksum,
                userAgent: getPulseSyncUserAgent(),
                progressScale: hasUnpacked ? PROGRESS_ASAR_WITH_UNPACKED.scale : PROGRESS_ASAR_ONLY.scale,
                rejectUnauthorized: false,
                name: 'app.asar',
            })
            await copyFile(tempAsarPath, asarPath)
            await pruneCacheFiles(CACHE_DIR, asarPath, file => file.toLowerCase().endsWith('.asar'), 'Failed to remove old asar cache:')
        }

        if (request.unpackLink && unpackedPath) {
            stage = 'unpacked'
            if (await isCachedArchiveValid(unpackedPath, request.unpackedChecksum)) {
                setProgressPercent(window, PROGRESS_UNPACKED.base + PROGRESS_UNPACKED.scale, 'app.asar.unpacked')
            } else {
                await downloadToTempWithProgress({
                    window,
                    url: request.unpackLink,
                    tempFilePath: tempUnpackedPath,
                    expectedChecksum: request.unpackedChecksum,
                    userAgent: getPulseSyncUserAgent(),
                    progressBase: PROGRESS_UNPACKED.base,
                    progressScale: PROGRESS_UNPACKED.scale,
                    rejectUnauthorized: false,
                    name: 'app.asar.unpacked',
                })
                await copyFile(tempUnpackedPath, unpackedPath)
                await pruneCacheFiles(
                    CACHE_DIR,
                    unpackedPath,
                    file => file.toLowerCase().endsWith(unpackedExtension.toLowerCase()),
                    'Failed to remove old unpacked cache:',
                )
            }
        }

        setProgressPercent(window, 1, hasUnpacked ? 'app.asar.unpacked' : 'app.asar')
        return { asarPath, identity, request, unpackedPath }
    } catch (error: any) {
        logger.modManager.error('Failed to prepare mod update cache:', error)
        const type =
            error instanceof DownloadError && error.code === 'checksum_mismatch'
                ? 'checksum_mismatch'
                : stage === 'unpacked'
                  ? 'download_unpacked_error'
                  : 'download_error'
        onFailure({ error: error?.message || t('main.modDownload.networkError'), type })
        return null
    } finally {
        unlinkIfExists(tempAsarPath)
        unlinkIfExists(tempUnpackedPath)
    }
}

const isFallbackEligibleDownloadFailure = (failure: ModDownloadFailure | null): failure is ModDownloadFailure =>
    Boolean(failure && MOD_DOWNLOAD_FALLBACK_TYPES.has(failure.type))

const getGithubInstallRequest = async (): Promise<DesktopInstallModRequest | null> => {
    const release = await getGithubModRelease()
    if (!release?.downloadUrl) return null

    return {
        version: release.modVersion,
        musicVersion: release.realMusicVersion,
        name: release.name,
        link: release.downloadUrl,
        unpackLink: release.downloadUnpackedUrl || undefined,
        unpackedChecksum: release.unpackedChecksum || undefined,
        checksum: release.checksum_v2 || undefined,
        shouldReinstall: release.shouldReinstall,
        source: 'github',
        channel: 'stable',
        branch: '',
        commit: '',
    }
}

clearCacheOnVersionChange()

export const modManager = (window: BrowserWindow): void => {
    let preparedModUpdate: PreparedModUpdate | null = null
    let preparedRequestIdentity: string | null = null
    let queuedModUpdate: DesktopInstallModRequest | null = null
    let preparingModUpdate = false
    let preparingModUpdateIdentity: string | null = null

    const processModUpdateQueue = async () => {
        if (preparingModUpdate) return
        preparingModUpdate = true

        try {
            while (queuedModUpdate) {
                const request = queuedModUpdate
                queuedModUpdate = null
                const requestedIdentity = getModUpdateIdentity(request)
                preparingModUpdateIdentity = requestedIdentity

                sendToRenderer(window, RendererEvents.MOD_UPDATE_DOWNLOAD_STARTED, { version: request.version })

                let primaryFailure: ModDownloadFailure | null = null
                let prepared = await downloadModUpdateToCache(window, request, failure => {
                    primaryFailure = failure
                })

                if (!prepared && request.source !== 'github' && isFallbackEligibleDownloadFailure(primaryFailure)) {
                    try {
                        logger.modManager.warn('Backend mod update preparation failed, trying GitHub fallback', primaryFailure)
                        const fallbackRequest = await getGithubInstallRequest()
                        if (fallbackRequest) {
                            prepared = await downloadModUpdateToCache(window, fallbackRequest, failure => {
                                primaryFailure = failure
                            })
                        }
                    } catch (fallbackError) {
                        logger.modManager.error('GitHub fallback for mod update preparation failed', fallbackError)
                    }
                }

                if (queuedModUpdate && getModUpdateIdentity(queuedModUpdate) !== requestedIdentity) {
                    continue
                }

                if (!prepared) {
                    sendFailure(window, primaryFailure ?? { error: t('main.modDownload.networkError'), type: 'download_error' })
                    continue
                }

                preparedModUpdate = prepared
                preparedRequestIdentity = requestedIdentity
                sendToRenderer(window, RendererEvents.MOD_UPDATE_READY, { release: prepared.request })
                resetProgress(window)
            }
        } finally {
            preparingModUpdate = false
            preparingModUpdateIdentity = null
        }
    }

    ipcMain.on(MainEvents.PREPARE_MOD_UPDATE, (_event, request: DesktopInstallModRequest) => {
        const identity = getModUpdateIdentity(request)
        const currentPreparedUpdate = preparedModUpdate
        if (
            currentPreparedUpdate &&
            (currentPreparedUpdate.identity === identity || preparedRequestIdentity === identity) &&
            fileExists(currentPreparedUpdate.asarPath)
        ) {
            sendToRenderer(window, RendererEvents.MOD_UPDATE_READY, { release: currentPreparedUpdate.request })
            return
        }
        if (preparingModUpdateIdentity === identity) return

        queuedModUpdate = request
        void processModUpdateQueue()
    })

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
        async (_event, request: DesktopInstallModRequest) => {
            try {
                const { version, musicVersion, name, link, unpackLink, unpackedChecksum, checksum, shouldReinstall, source, channel, branch, commit } =
                    request
                const requestIdentity = getModUpdateIdentity(request)
                const preparedArtifacts = preparedModUpdate?.identity === requestIdentity ? preparedModUpdate : null

                sendToRenderer(window, RendererEvents.MOD_INSTALL_STARTED, {
                    isUpdate: Boolean(State.get('mod.installed') && State.get('mod.version')),
                })

                const installSource = source === 'github' ? 'github' : 'backend'

                if (shouldReinstall && !State.get('settings.musicReinstalled') && isWindows()) {
                    State.set('settings.musicReinstalled', true)
                    await downloadYandexMusic('reinstall')
                    return
                }

                const paths = await ensureLinuxModPath(await resolveBasePaths())

                const wasClosed = await closeMusicIfRunning(window)

                const ymMetadata = await getInstalledYmMetadata()
                const resolvedMusicVersion = ymMetadata?.version ?? musicVersion
                let finalProgressName = 'app.asar'

                if (isMac()) {
                    try {
                        await copyFile(paths.modAsar, paths.modAsar)
                        await copyFile(paths.infoPlist, paths.infoPlist)
                    } catch {
                        window.webContents.send(RendererEvents.REQUEST_MAC_PERMISSIONS)
                        return sendFailure(window, { error: t('main.modManager.fullDiskAccessRequired'), type: 'file_copy_error' })
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
                    if (isLinuxAccessError(e)) {
                        sendFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' })
                        return
                    }
                    HandleErrorsElectron.handleError('modManager', 'install', 'backup', e)
                    sendFailure(window, { error: e?.message || String(e), type: 'backup_error' })
                    return
                }

                const applyReleaseArtifacts = async (
                    releaseData: {
                        checksum?: string
                        branch?: string
                        channel?: 'stable' | 'branch'
                        commit?: string
                        link: string
                        name: string
                        preparedAsarPath?: string
                        preparedUnpackedPath?: string
                        unpackLink?: string
                        unpackedChecksum?: string
                        version: string
                    },
                    onFailure?: (failure: ModDownloadFailure) => void,
                ): Promise<boolean> => {
                    const tempFilePath = path.join(TEMP_DIR, 'app.asar.download')
                    const hasUnpacked = Boolean(releaseData.unpackLink)
                    finalProgressName = hasUnpacked ? 'app.asar.unpacked' : 'app.asar'
                    const asarProgress = hasUnpacked ? PROGRESS_ASAR_WITH_UNPACKED : PROGRESS_ASAR_ONLY
                    const unpackedProgress = hasUnpacked ? PROGRESS_UNPACKED : undefined
                    let preparedAsarApplied = false

                    if (releaseData.preparedAsarPath && (await isCachedArchiveValid(releaseData.preparedAsarPath, releaseData.checksum))) {
                        try {
                            const preparedFilePath = `${tempFilePath}.prepared.${process.pid}.${Date.now()}.asar`
                            preparedAsarApplied = await prepareAndInstallAsarArtifact(
                                releaseData.preparedAsarPath,
                                preparedFilePath,
                                releaseData.link,
                                paths.modAsar,
                                paths.backupAsar,
                                releaseData.checksum,
                            )
                            if (preparedAsarApplied) {
                                setProgressPercent(window, asarProgress.base + asarProgress.scale, 'app.asar')
                            }
                        } catch (cacheError) {
                            logger.modManager.warn('Failed to apply prepared mod update cache, downloading again:', cacheError)
                        }
                    }

                    if (preparedAsarApplied) {
                        logger.modManager.info('Applied prepared app.asar update from cache')
                    } else if (releaseData.checksum) {
                        const cacheFile = path.join(CACHE_DIR, `${releaseData.checksum}.asar`)
                        await fs.promises.mkdir(CACHE_DIR, { recursive: true }).catch(err => {
                            logger.modManager.warn('Failed to create cache dir:', err)
                        })

                        const currentHash = fileExists(paths.modAsar) ? await readChecksum(paths.modAsar) : null
                        if (currentHash === releaseData.checksum) {
                            logger.modManager.info('app.asar hash matches, skipping download')
                            sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: t('main.modManager.modAlreadyInstalled') })
                            if (hasUnpacked) {
                                setProgressPercent(window, PROGRESS_UNPACKED.base, 'app.asar.unpacked')
                            } else {
                                setProgressPercent(window, PROGRESS_ASAR_ONLY.scale, 'app.asar')
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
                        const unpackedBoundaryStartedAt = Date.now()
                        setProgressPercent(window, PROGRESS_UNPACKED.base, 'app.asar.unpacked')
                        logger.modManager.info('Starting app.asar.unpacked stage', {
                            progressUpdateMs: Date.now() - unpackedBoundaryStartedAt,
                        })

                        const unpackName = path.basename(new URL(releaseData.unpackLink).pathname)
                        const tempUnpackedArchive = path.join(TEMP_DIR, unpackName || 'app.asar.unpacked')
                        const tempUnpackedDir = path.join(TEMP_DIR, `pulsesync-unpacked-${process.pid}-${Date.now()}`)
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
                            releaseData.preparedUnpackedPath,
                        )
                        if (!unpackedOk) return false
                    }

                    const actualAsarChecksum = (await readChecksum(paths.modAsar)) ?? releaseData.checksum
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
                        sourceType: releaseData.channel === 'branch' ? 'branch' : 'stable',
                        branch: releaseData.channel === 'branch' ? releaseData.branch || '' : '',
                        commit: releaseData.channel === 'branch' ? releaseData.commit || '' : '',
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
                        channel,
                        branch,
                        commit,
                        preparedAsarPath: preparedArtifacts?.asarPath,
                        preparedUnpackedPath: preparedArtifacts?.unpackedPath,
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
                                        channel: 'stable',
                                        branch: '',
                                        commit: '',
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
                            HandleErrorsElectron.handleError('modManager', 'install', 'github_fallback', fallbackError)
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

                setProgressPercent(window, 1, finalProgressName)
                if (preparedModUpdate?.identity === requestIdentity) {
                    preparedModUpdate = null
                    preparedRequestIdentity = null
                }
                if (await sendSuccessAfterLaunch(window, wasClosed, RendererEvents.DOWNLOAD_SUCCESS, { success: true })) return
            } catch (error: any) {
                logger.modManager.error('Unexpected error:', error)
                if (isLinuxAccessError(error)) {
                    sendFailure(window, { error: t('main.modManager.linuxPermissionsRequired'), type: 'linux_permissions_required' })
                    return
                }
                HandleErrorsElectron.handleError('modManager', 'install', 'unexpected', error)
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
            HandleErrorsElectron.handleError('modManager', 'remove', 'unexpected', error)
            sendToRenderer(window, RendererEvents.REMOVE_MOD_FAILURE, { success: false, error: error.message, type: 'remove_mod_error' })
        }
    })
    ipcMain.on(MainEvents.CLEAR_MOD_CACHE, async () => {
        try {
            await fs.promises.rm(CACHE_DIR, { recursive: true, force: true })
            sendToRenderer(window, RendererEvents.CLEAR_MOD_CACHE_SUCCESS, { success: true })
        } catch (error: any) {
            logger.modManager.error('Failed to clear mod cache:', error)
            HandleErrorsElectron.handleError('modManager', 'clear_cache', 'unexpected', error)
            sendToRenderer(window, RendererEvents.CLEAR_MOD_CACHE_FAILURE, {
                success: false,
                error: error?.message || 'Failed to clear mod cache',
            })
        }
    })
}
