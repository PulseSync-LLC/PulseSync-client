import { app, type BrowserWindow } from 'electron'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'
import logger from '../logger'
import { BootstrapperCommandError } from '../bootstrapper/command'
import { isUpdateErrorV1, type ActiveAppLeaseV1, type LaunchRequestEnvelopeV1, type PrepareUpdateResultV1 } from '../bootstrapper/contracts'
import type { BootstrapperRuntimePaths } from '../bootstrapper/paths'
import { getDesktopUpdateManifestRequest } from '../updater/desktopManifestSource'
import { getUpdateSource } from '../updater/updateSource'
import { updateCoordinator } from './updateCoordinator'
import type { BootstrapWindowController } from './bootstrapWindow'
import { setLaunchHandoffRuntime, handoffPreparedUpdate } from './launchHandoff'
import type { LaunchInbox } from './launchInbox'
import type { LaunchQueue } from './launchQueue'

export type ApplicationStartupHandle = {
    deliverLaunchRequest(request: LaunchRequestEnvelopeV1): Promise<boolean>
    ready: Promise<void>
}

export type ApplicationBootstrapRuntime = {
    getLastCheckAt(): number | null
    handoffPreparedUpdate(): Promise<boolean>
    leaseId: string
    runUpdate(options: Parameters<typeof updateCoordinator.run>[0]): ReturnType<typeof updateCoordinator.run>
}

export type ApplicationMainLoader = (
    bootstrapWindow: BrowserWindow,
    bootstrapRuntime: ApplicationBootstrapRuntime,
) => Promise<ApplicationStartupHandle>

export class StartupCoordinator {
    private applicationHandle: ApplicationStartupHandle | null = null
    private gatePromise: Promise<void> | null = null
    private unsubscribeState: (() => void) | null = null

    public constructor(
        private readonly options: {
            bootstrapWindow: BootstrapWindowController
            inbox: LaunchInbox
            lease: ActiveAppLeaseV1
            loadApplicationMain: ApplicationMainLoader
            queue: LaunchQueue
            runtimePaths: BootstrapperRuntimePaths
        },
    ) {
        this.unsubscribeState = updateCoordinator.subscribe(state => options.bootstrapWindow.publish(state))
        options.bootstrapWindow.setActionHandlers({
            retry: async () => {
                if (this.gatePromise || this.applicationHandle) return false
                void this.runGate()
                return true
            },
            continue: async () => {
                if (this.applicationHandle) return false
                await this.startApplication()
                return true
            },
        })
        setLaunchHandoffRuntime({
            inbox: options.inbox,
            lease: options.lease,
            publishState: state => options.bootstrapWindow.publish(state),
            queue: options.queue,
            runtimePaths: options.runtimePaths,
        })
    }

    public run(): Promise<void> {
        return this.runGate()
    }

    private runGate(): Promise<void> {
        if (this.gatePromise) return this.gatePromise
        const operation = this.executeGate().finally(() => {
            if (this.gatePromise === operation) this.gatePromise = null
        })
        this.gatePromise = operation
        return operation
    }

    private async executeGate(): Promise<void> {
        const launcher = this.options.runtimePaths.launcher
        if (!launcher) throw new Error('Bootstrapper launcher was not found')
        const request = getDesktopUpdateManifestRequest({ source: getUpdateSource() })
        try {
            const result = await updateCoordinator.run({
                activeLeaseId: this.options.lease.leaseId,
                appExecutableName: this.options.runtimePaths.appExecutableName,
                channel: request.channel,
                dist: request.dist,
                stateRoot: this.options.runtimePaths.stateRoot,
                hostBundle: this.options.runtimePaths.hostBundle,
                appExecutable: this.options.runtimePaths.appExecutable,
                installedVersion: app.getVersion(),
                launcher,
                manifestUrl: request.manifestUrl,
                requestedSource: request.requestedSource,
                retainAppVersions: 2,
                serverHealthUrl: request.serverHealthUrl,
                onDiagnostic: line => logger.updater.warn('Bootstrapper diagnostic', line),
            })
            await this.handleResult(result)
        } catch (error) {
            logger.updater.error('Bootstrap update gate failed', error)
            if (this.isSafeToContinue(error)) {
                await this.startApplicationAfterFailure()
            }
        }
    }

    private async handleResult(result: PrepareUpdateResultV1): Promise<void> {
        if (result.state === 'up-to-date') {
            await this.startApplication()
            return
        }
        if (result.state === 'prepared') {
            const handedOff = await handoffPreparedUpdate()
            if (!handedOff) await this.startApplicationAfterFailure()
            return
        }
        if (result.block.safeToContinue) {
            await this.startApplicationAfterFailure()
        }
    }

    private async startApplicationAfterFailure(): Promise<void> {
        this.options.bootstrapWindow.publish({
            schemaVersion: 1,
            phase: 'launching',
            statusKey: 'launching-client',
            progress: { kind: 'indeterminate' },
            actions: [],
        })
        await new Promise(resolve => setTimeout(resolve, 800))
        await this.startApplication()
    }

    private async startApplication(): Promise<void> {
        if (this.applicationHandle) return
        const handle = await this.options.loadApplicationMain(this.options.bootstrapWindow.window, {
            leaseId: this.options.lease.leaseId,
            getLastCheckAt: () => updateCoordinator.lastCheckAt,
            runUpdate: options => updateCoordinator.run(options),
            handoffPreparedUpdate,
        })
        this.applicationHandle = handle
        await this.options.inbox.start(request => handle.deliverLaunchRequest(request))
        await handle.ready
        this.unsubscribeState?.()
        this.unsubscribeState = null
    }

    private isSafeToContinue(error: unknown): boolean {
        if (!(error instanceof BootstrapperCommandError) || !isUpdateErrorV1(error.result)) return false
        return error.result.error.safeToContinue
    }
}
