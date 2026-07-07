import * as semver from 'semver'
import { app, type BrowserWindow } from 'electron'
import { state } from '../handlers/state'
import RendererEvents from '../../../common/types/rendererEvents'
import { UpdateStatus } from './constants/updateStatus'
import logger from '../logger'
import { mainWindow } from '../createWindow'
import { getUpdateSource, type UpdateSource } from './updateSource'
import { getBootstrapperInstallDir, getBootstrapperRuntimePaths, getBootstrapperTransactionRoot } from '../bootstrapper/paths'
import { relaunchThroughBootstrapper } from '../bootstrapper/relaunch'
import {
    checkAndPrepareDesktopUpdate,
    clearPreparedDesktopUpdate,
    type BootstrapperUpdateDecision,
    type BootstrapperUpdateManifest,
} from './bootstrapperUpdateService'
import { resolveDesktopUpdateManifestSource } from './desktopManifestSource'

class Updater {
    private latestAvailableVersion: string | null = null
    private updateStatus: UpdateStatus = UpdateStatus.IDLE
    private updaterId: NodeJS.Timeout | null = null
    private onUpdateListeners: Array<(version: string) => void> = []

    private isRuntimeUpdateEnabled(): boolean {
        return app.isPackaged || process.env.PULSESYNC_ENABLE_DEV_UPDATER === '1'
    }

    private getWindow(): BrowserWindow | null {
        const win = mainWindow as unknown as BrowserWindow | undefined
        if (!win) return null
        if (win.isDestroyed()) return null
        return win
    }

    private safeSend(channel: string, ...args: unknown[]) {
        const win = this.getWindow()
        if (!win) return
        try {
            win.webContents.send(channel as any, ...(args as any[]))
        } catch (e) {
            logger.updater.error('Failed to send renderer event', channel, e)
        }
    }

    private setProgressBar(value: number) {
        const win = this.getWindow()
        if (!win) return
        try {
            win.setProgressBar(value)
        } catch (e) {
            logger.updater.error('Failed to set progress bar', e)
        }
    }

    private flashFrame(value: boolean) {
        const win = this.getWindow()
        if (!win) return
        try {
            win.flashFrame(value)
        } catch (e) {
            logger.updater.error('Failed to flash frame', e)
        }
    }

    private notifyAvailable(version: string) {
        this.latestAvailableVersion = version
        for (const listener of this.onUpdateListeners) {
            try {
                listener(version)
            } catch (error) {
                logger.updater.error('onUpdate listener error', error)
            }
        }
    }

    private isDeprecatedByManifest(manifest: BootstrapperUpdateManifest): boolean {
        if (!manifest.deprecatedVersions?.length) {
            return false
        }

        for (const deprecatedRange of manifest.deprecatedVersions) {
            try {
                if (semver.satisfies(app.getVersion(), deprecatedRange)) {
                    logger.updater.info('This version is deprecated', app.getVersion(), deprecatedRange)
                    return true
                }
            } catch (error) {
                logger.updater.error('Failed to evaluate deprecated version range', { deprecatedRange, error })
            }
        }

        return false
    }

    private handleUpdateDecision(decision: BootstrapperUpdateDecision, manual: boolean) {
        if (!decision.updateAvailable) {
            return
        }

        this.latestAvailableVersion = decision.targetVersion
        this.updateStatus = UpdateStatus.DOWNLOADING
        this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
        logger.updater.info('New version available', app.getVersion(), '->', decision.targetVersion)
    }

    async check(
        manual = false,
        options?: {
            sourceOverride?: UpdateSource
        },
    ): Promise<UpdateStatus | null> {
        if (!this.isRuntimeUpdateEnabled()) {
            logger.updater.info('Skipping desktop update check in non-packaged runtime')
            this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            return null
        }

        const source = options?.sourceOverride ?? getUpdateSource()

        if (this.updateStatus !== UpdateStatus.IDLE) {
            logger.updater.log('New update is processing', this.updateStatus)

            if (this.updateStatus === UpdateStatus.DOWNLOADED && this.latestAvailableVersion) {
                this.safeSend(RendererEvents.UPDATE_AVAILABLE, this.latestAvailableVersion)
                this.flashFrame(true)
            }

            return this.updateStatus
        }

        try {
            this.updateStatus = UpdateStatus.CHECKING
            this.safeSend(RendererEvents.CHECK_UPDATE, { checking: true, manual })

            const manifestSource = await resolveDesktopUpdateManifestSource({ source })
            const runtimePaths = getBootstrapperRuntimePaths()
            if (!runtimePaths.launcher) {
                throw new Error('Bootstrapper launcher was not found')
            }

            const stagingRootDir = getBootstrapperTransactionRoot()
            const result = await checkAndPrepareDesktopUpdate({
                installDir: getBootstrapperInstallDir(),
                installedVersion: app.getVersion(),
                launcher: runtimePaths.launcher,
                manifestSource,
                stagingRootDir,
                onDecision: decision => this.handleUpdateDecision(decision, manual),
                onProgress: progress => {
                    this.setProgressBar(progress.percent / 100)
                    logger.updater.log('Download progress', progress.percent)
                    this.safeSend(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, progress.percent)
                },
            })

            if (result.state === 'no-update') {
                this.latestAvailableVersion = null
                this.updateStatus = UpdateStatus.IDLE
                this.setProgressBar(-1)
                this.flashFrame(false)
                logger.updater.log('No updates found')
                this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
                return null
            }

            if (result.state !== 'prepared') {
                this.latestAvailableVersion = null
                this.updateStatus = UpdateStatus.IDLE
                this.setProgressBar(-1)
                this.flashFrame(false)
                logger.updater.error('Bootstrapper update preparation blocked', result.prepareResult)
                this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED)
                return this.updateStatus
            }

            logger.updater.info('Bootstrapper update prepared', {
                channel: result.decision.channel,
                dist: result.decision.dist,
                state: result.prepareResult.state,
                targetVersion: result.decision.targetVersion,
                transactionDir: result.prepareResult.transactionDir,
            })
            this.latestAvailableVersion = result.decision.targetVersion
            this.updateStatus = UpdateStatus.DOWNLOADED
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
            this.setProgressBar(-1)
            this.flashFrame(true)
            this.safeSend(RendererEvents.UPDATE_APP_DATA, { update: true })
            this.notifyAvailable(result.decision.targetVersion)

            if (this.isDeprecatedByManifest(result.manifest)) {
                await this.install()
            }
        } catch (error: unknown) {
            this.latestAvailableVersion = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            logger.updater.error('Error: checking for updates', error)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED)
        }

        return this.updateStatus
    }

    start() {
        if (!this.isRuntimeUpdateEnabled()) {
            logger.updater.info('Skipping desktop updater start in non-packaged runtime')
            return
        }

        if (this.updaterId) return
        void this.check(false)
        this.updaterId = setInterval(() => {
            void this.check(false)
        }, 900000)
    }

    stop() {
        if (!this.updaterId) return
        clearInterval(this.updaterId)
        this.updaterId = null
    }

    onUpdate(listener: (version: string) => void) {
        this.onUpdateListeners.push(listener)
    }

    reloadFeed() {
        logger.updater.info('Bootstrapper updater source will be resolved on next check')
    }

    getStatus() {
        return this.updateStatus
    }

    async clearPendingUpdate(reason = 'manual-reset') {
        if (this.updateStatus !== UpdateStatus.DOWNLOADED) {
            return false
        }

        try {
            await clearPreparedDesktopUpdate({
                allowedParentDir: app.getPath('userData'),
                stagingRootDir: getBootstrapperTransactionRoot(),
            })

            this.latestAvailableVersion = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)

            logger.updater.info('Cleared pending prepared update', { reason })
            return true
        } catch (error) {
            logger.updater.error('Failed to clear pending prepared update', error)
            return false
        }
    }

    async install() {
        if (!this.isRuntimeUpdateEnabled()) {
            logger.updater.info('Skipping desktop update install in non-packaged runtime')
            return false
        }

        logger.updater.info('Installing a new version', this.latestAvailableVersion)
        state.willQuit = true

        const runtimePaths = getBootstrapperRuntimePaths()
        if (!runtimePaths.launcher) {
            logger.updater.error('Bootstrapper relaunch is unavailable: launcher was not found')
            state.willQuit = false
            return false
        }

        try {
            const result = await relaunchThroughBootstrapper({
                appExecutable: runtimePaths.appExecutable,
                appExecutableName: runtimePaths.appExecutableName,
                installRoot: runtimePaths.installRoot,
                launcher: runtimePaths.launcher,
                transactionRoot: runtimePaths.transactionRoot,
            })
            logger.updater.info('Bootstrapper relaunch spawned', {
                launcherKind: result.launcherKind,
                launcherSource: result.launcherSource,
                pid: result.pid,
                transactionRoot: runtimePaths.transactionRoot,
            })
            app.quit()
            return true
        } catch (error) {
            logger.updater.error('Bootstrapper relaunch failed', error)
            state.willQuit = false
            return false
        }
    }
}

export const getUpdater = (() => {
    let updater: Updater | undefined
    return () => {
        if (!updater) {
            updater = new Updater()
        }
        return updater
    }
})()
