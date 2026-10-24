import { app, type BrowserWindow } from 'electron'

import { DESKTOP_CORE_VERSION } from '@common/desktopRuntime/version'

import RendererEvents from '../../../common/types/rendererEvents'
import { getBootstrapperRuntimePaths } from '../../shared/bootstrapper/paths'
import logger from '../../shared/logger'
import { discardPreparedUpdate, type PrepareDesktopUpdateOptions, type PrepareUpdateResultV1 } from '../../shared/updater/bootstrapperUpdateService'
import { getDesktopUpdateManifestRequest } from '../../shared/updater/desktopManifestSource'
import { getUpdateSource, type UpdateSource } from '../../shared/updater/updateSource'
import { mainWindow } from '../createWindow'
import { UpdateStatus } from './constants/updateStatus'

import type { DesktopUpdateFailurePayload } from '@common/desktopApi/contract'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

const UPDATE_INTERVAL_MS = 15 * 60 * 1000

export type UpdaterBootstrapRuntime = {
    getLastCheckAt(): number | null
    handoffPreparedUpdate(): Promise<boolean>
    leaseId: string
    runUpdate(options: PrepareDesktopUpdateOptions): Promise<PrepareUpdateResultV1>
}

let bootstrapRuntime: UpdaterBootstrapRuntime | null = null

export function configureUpdaterBootstrapRuntime(runtime: UpdaterBootstrapRuntime): void {
    bootstrapRuntime = runtime
}

class Updater {
    private installInFlight = false
    private preferenceChangeInFlight = false
    private lastCheckAt: number | null = null
    private latestAvailableVersion: string | null = null
    private onUpdateListeners: Array<(version: string) => void> = []
    private preparedTransactionId: string | null = null
    private updateStatus: UpdateStatus = UpdateStatus.IDLE
    private updaterId: NodeJS.Timeout | null = null

    private isRuntimeUpdateEnabled(): boolean {
        return app.isPackaged || process.env.PULSESYNC_ENABLE_DEV_UPDATER === '1'
    }

    private getWindow(): BrowserWindow | null {
        const win = mainWindow as unknown as BrowserWindow | undefined
        if (!win || win.isDestroyed()) return null
        return win
    }

    private safeSend(channel: string, ...args: unknown[]): void {
        const win = this.getWindow()
        if (!win) return
        try {
            win.webContents.send(channel as never, ...args)
        } catch (error) {
            logger.updater.error('Failed to send renderer event', channel, error)
        }
    }

    private setProgressBar(value: number): void {
        const win = this.getWindow()
        if (!win) return
        try {
            win.setProgressBar(value)
        } catch (error) {
            logger.updater.error('Failed to set progress bar', error)
        }
    }

    private flashFrame(value: boolean): void {
        const win = this.getWindow()
        if (!win) return
        try {
            win.flashFrame(value && !win.isFocused())
        } catch (error) {
            logger.updater.error('Failed to flash frame', error)
        }
    }

    private notifyAvailable(version: string): void {
        if (this.latestAvailableVersion === version) return
        this.latestAvailableVersion = version
        this.flashFrame(true)
        for (const listener of this.onUpdateListeners) {
            try {
                listener(version)
            } catch (error) {
                logger.updater.error('onUpdate listener error', error)
            }
        }
    }

    private handleProgress(resultState: BootstrapUiStateV1): void {
        if (resultState.phase === 'downloading-app' || resultState.phase === 'downloading-modules') {
            this.updateStatus = UpdateStatus.DOWNLOADING
        }
        if (resultState.progress.kind !== 'bytes') {
            this.setProgressBar(2)
            if (resultState.phase === 'preparing') {
                this.safeSend(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, { phase: 'preparing' })
            }
            return
        }
        const ratio = resultState.progress.read / resultState.progress.total
        const percent = Math.min(100, Math.floor(ratio * 100))
        this.setProgressBar(ratio)
        this.safeSend(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, percent)
    }

    public async check(manual = false, options?: { sourceOverride?: UpdateSource; suppressUpToDateEvent?: boolean }): Promise<UpdateStatus | null> {
        if (!this.isRuntimeUpdateEnabled()) {
            logger.updater.info('Skipping desktop update check in non-packaged runtime')
            if (!options?.suppressUpToDateEvent) this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            return null
        }
        this.lastCheckAt = Date.now()
        if (this.preferenceChangeInFlight) return UpdateStatus.CHECKING
        if (this.installInFlight || this.updateStatus !== UpdateStatus.IDLE) {
            if (manual && !this.installInFlight && this.updateStatus === UpdateStatus.DOWNLOADED && this.latestAvailableVersion) {
                this.safeSend(RendererEvents.CHECK_UPDATE, { checking: true, manual })
                this.safeSend(RendererEvents.UPDATE_AVAILABLE, { kind: 'client', version: this.latestAvailableVersion })
            }
            return this.updateStatus
        }

        let failurePhase: DesktopUpdateFailurePayload['phase'] = 'check'
        try {
            this.updateStatus = UpdateStatus.CHECKING
            this.safeSend(RendererEvents.CHECK_UPDATE, { checking: true, manual })
            const runtimePaths = getBootstrapperRuntimePaths()
            if (!runtimePaths.launcher) {
                throw new Error('Bootstrapper launcher was not found')
            }
            const runtime = bootstrapRuntime
            if (!runtime) throw new Error('Electron bootstrap update runtime is unavailable')
            const request = getDesktopUpdateManifestRequest({ source: options?.sourceOverride ?? getUpdateSource() })
            const result = await runtime.runUpdate({
                activeLeaseId: runtime.leaseId,
                appExecutableName: runtimePaths.appExecutableName,
                channel: request.channel,
                dist: request.dist,
                stateRoot: runtimePaths.stateRoot,
                hostBundle: runtimePaths.hostBundle,
                appExecutable: runtimePaths.appExecutable,
                installedVersion: DESKTOP_CORE_VERSION,
                launcher: runtimePaths.launcher,
                manifestUrl: request.manifestUrl,
                requestedSource: request.requestedSource,
                retainAppVersions: 2,
                serverHealthUrl: request.serverHealthUrl,
                onDiagnostic: line => logger.updater.warn('Bootstrapper diagnostic', line),
                onProgress: (_event, uiState) => {
                    failurePhase =
                        uiState.phase === 'preparing'
                            ? 'prepare'
                            : uiState.phase === 'downloading-app' || uiState.phase === 'downloading-modules'
                              ? 'download'
                              : 'check'
                    this.handleProgress(uiState)
                },
            })
            return await this.handleResult(result, manual, options?.suppressUpToDateEvent ?? false)
        } catch (error) {
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            logger.updater.error('Error checking for updates', error)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED, { phase: failurePhase })
            return this.updateStatus
        } finally {
            this.lastCheckAt = Date.now()
        }
    }

    private async handleResult(result: PrepareUpdateResultV1, manual: boolean, suppressUpToDateEvent: boolean): Promise<UpdateStatus | null> {
        if (result.state === 'up-to-date') {
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            if (!suppressUpToDateEvent) this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            return null
        }
        if (result.state === 'blocked') {
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            logger.updater.error('Bootstrapper update preparation blocked', result.block)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED, { phase: 'prepare', code: result.block.code })
            return this.updateStatus
        }

        this.preparedTransactionId = result.transaction.id
        this.updateStatus = UpdateStatus.DOWNLOADED
        this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
        this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
        this.setProgressBar(-1)
        this.notifyAvailable(result.decision.targetVersion)
        logger.updater.info('Bootstrapper update prepared', {
            channel: result.decision.channel,
            dist: result.decision.dist,
            effectiveSource: result.source.effective,
            fallbackUsed: result.source.fallbackUsed,
            targetVersion: result.decision.targetVersion,
            transactionId: result.transaction.id,
            plan: result.decision.plan,
        })
        if (result.decision.policy.forced) {
            await this.install()
        }
        return this.updateStatus
    }

    public start(): void {
        if (!this.isRuntimeUpdateEnabled() || this.updaterId) return
        const freshAt = this.lastCheckAt ?? bootstrapRuntime?.getLastCheckAt() ?? Date.now()
        const delay = Math.max(0, UPDATE_INTERVAL_MS - (Date.now() - freshAt))
        this.updaterId = setTimeout(() => {
            this.updaterId = null
            void this.check(false).finally(() => this.start())
        }, delay)
    }

    public onUpdate(listener: (version: string) => void): void {
        this.onUpdateListeners.push(listener)
    }

    public reloadFeed(): void {
        logger.updater.info('Bootstrapper updater preferences will be used on the next check')
    }

    public getStatus(): UpdateStatus {
        return this.updateStatus
    }

    public isBusy(): boolean {
        return (
            this.preferenceChangeInFlight ||
            this.installInFlight ||
            this.updateStatus === UpdateStatus.CHECKING ||
            this.updateStatus === UpdateStatus.DOWNLOADING
        )
    }

    public async changePreferences(apply: () => void, reason: string): Promise<void> {
        if (this.isBusy()) throw new Error('UPDATE_SOURCE_BUSY')
        this.preferenceChangeInFlight = true
        try {
            if (this.updateStatus === UpdateStatus.DOWNLOADED && !(await this.clearPendingUpdate(reason))) {
                throw new Error('UPDATE_RESET_FAILED')
            }
            apply()
        } finally {
            this.preferenceChangeInFlight = false
        }
    }

    public async clearPendingUpdate(reason = 'manual-reset'): Promise<boolean> {
        if (this.updateStatus !== UpdateStatus.DOWNLOADED || !this.preparedTransactionId) {
            return false
        }
        const discardReason = reason.startsWith('channel-switch:')
            ? 'channel-change'
            : reason.startsWith('source-switch:')
              ? 'source-change'
              : 'manual-reset'
        try {
            const runtimePaths = getBootstrapperRuntimePaths()
            if (!runtimePaths.launcher) return false
            const result = await discardPreparedUpdate({
                stateRoot: runtimePaths.stateRoot,
                hostBundle: runtimePaths.hostBundle,
                launcher: runtimePaths.launcher,
                reason: discardReason,
                transactionId: this.preparedTransactionId,
            })
            if (result.state === 'blocked') return false
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            return true
        } catch (error) {
            logger.updater.error('Failed to discard pending update', error)
            return false
        }
    }

    public async install(): Promise<boolean> {
        if (!this.isRuntimeUpdateEnabled() || this.installInFlight || this.preferenceChangeInFlight) return false
        this.installInFlight = true
        this.safeSend(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, { phase: 'installing' })
        try {
            const handedOff = (await bootstrapRuntime?.handoffPreparedUpdate()) ?? false
            if (handedOff) return true
            throw new Error('Bootstrapper did not accept the prepared update')
        } catch (error) {
            logger.updater.error('Bootstrapper handoff failed', error)
            // A failed handoff leaves this process alive. Release its prepared
            // update so the next manual check can prepare a fresh transaction.
            await this.clearPendingUpdate('install-failed')
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED, { phase: 'install', code: 'handoff-failed' })
            return false
        } finally {
            this.installInFlight = false
        }
    }
}

export const getUpdater = (() => {
    let updater: Updater | undefined
    return () => (updater ??= new Updater())
})()
