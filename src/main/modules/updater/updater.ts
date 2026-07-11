import { app, type BrowserWindow } from 'electron'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { mainWindow } from '../createWindow'
import { state } from '../handlers/state'
import logger from '../logger'
import { getBootstrapperRuntimePaths } from '../bootstrapper/paths'
import { discardPreparedUpdate, type PrepareDesktopUpdateOptions, type PrepareUpdateResultV1 } from './bootstrapperUpdateService'
import { UpdateStatus } from './constants/updateStatus'
import { getDesktopUpdateManifestRequest } from './desktopManifestSource'
import { getUpdateSource, type UpdateSource } from './updateSource'

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
            win.flashFrame(value)
        } catch (error) {
            logger.updater.error('Failed to flash frame', error)
        }
    }

    private notifyAvailable(version: string): void {
        this.latestAvailableVersion = version
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
            return
        }
        const ratio = resultState.progress.read / resultState.progress.total
        const percent = Math.min(100, Math.floor(ratio * 100))
        this.setProgressBar(ratio)
        this.safeSend(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, percent)
    }

    public async check(manual = false, options?: { sourceOverride?: UpdateSource }): Promise<UpdateStatus | null> {
        if (!this.isRuntimeUpdateEnabled()) {
            logger.updater.info('Skipping desktop update check in non-packaged runtime')
            this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            return null
        }
        if (this.updateStatus !== UpdateStatus.IDLE) {
            if (this.updateStatus === UpdateStatus.DOWNLOADED && this.latestAvailableVersion) {
                this.safeSend(RendererEvents.UPDATE_AVAILABLE, this.latestAvailableVersion)
                this.flashFrame(true)
            }
            return this.updateStatus
        }

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
                installedVersion: app.getVersion(),
                launcher: runtimePaths.launcher,
                manifestUrl: request.manifestUrl,
                requestedSource: request.requestedSource,
                retainAppVersions: 2,
                serverHealthUrl: request.serverHealthUrl,
                onDiagnostic: line => logger.updater.warn('Bootstrapper diagnostic', line),
                onProgress: (_event, uiState) => this.handleProgress(uiState),
            })
            return await this.handleResult(result, manual)
        } catch (error) {
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            logger.updater.error('Error checking for updates', error)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED)
            return this.updateStatus
        }
    }

    private async handleResult(result: PrepareUpdateResultV1, manual: boolean): Promise<UpdateStatus | null> {
        if (result.state === 'up-to-date') {
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
            return null
        }
        if (result.state === 'blocked') {
            this.latestAvailableVersion = null
            this.preparedTransactionId = null
            this.updateStatus = UpdateStatus.IDLE
            this.setProgressBar(-1)
            this.flashFrame(false)
            logger.updater.error('Bootstrapper update preparation blocked', result.block)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED)
            return this.updateStatus
        }

        this.latestAvailableVersion = result.decision.targetVersion
        this.preparedTransactionId = result.transaction.id
        this.updateStatus = UpdateStatus.DOWNLOADED
        this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: true, manual })
        this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
        this.safeSend(RendererEvents.UPDATE_APP_DATA, { update: true })
        this.setProgressBar(-1)
        this.flashFrame(true)
        this.notifyAvailable(result.decision.targetVersion)
        logger.updater.info('Bootstrapper update prepared', {
            channel: result.decision.channel,
            dist: result.decision.dist,
            effectiveSource: result.source.effective,
            fallbackUsed: result.source.fallbackUsed,
            targetVersion: result.decision.targetVersion,
            transactionId: result.transaction.id,
        })
        if (result.decision.policy.forced) {
            await this.install()
        }
        return this.updateStatus
    }

    public start(): void {
        if (!this.isRuntimeUpdateEnabled() || this.updaterId) return
        const freshAt = bootstrapRuntime?.getLastCheckAt() ?? null
        const delay = freshAt === null ? 0 : Math.max(0, UPDATE_INTERVAL_MS - (Date.now() - freshAt))
        this.updaterId = setTimeout(() => {
            this.updaterId = null
            void this.check(false).finally(() => this.start())
        }, delay)
    }

    public stop(): void {
        if (!this.updaterId) return
        clearTimeout(this.updaterId)
        this.updaterId = null
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

    public async clearPendingUpdate(reason = 'manual-reset'): Promise<boolean> {
        if (this.updateStatus !== UpdateStatus.DOWNLOADED || !this.preparedTransactionId) {
            return false
        }
        const runtimePaths = getBootstrapperRuntimePaths()
        if (!runtimePaths.launcher) return false
        const discardReason = reason.startsWith('channel-switch:')
            ? 'channel-change'
            : reason.startsWith('source-switch:')
              ? 'source-change'
              : 'manual-reset'
        try {
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
        if (!this.isRuntimeUpdateEnabled()) return false
        state.willQuit = true
        try {
            const handedOff = (await bootstrapRuntime?.handoffPreparedUpdate()) ?? false
            if (!handedOff) state.willQuit = false
            return handedOff
        } catch (error) {
            logger.updater.error('Bootstrapper handoff failed', error)
            state.willQuit = false
            return false
        }
    }
}

export const getUpdater = (() => {
    let updater: Updater | undefined
    return () => (updater ??= new Updater())
})()
