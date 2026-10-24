import { type BrowserWindow } from 'electron'

import { type ActiveAppLeaseV1, type LaunchRequestEnvelopeV1, type PrepareUpdateResultV1 } from '../../shared/bootstrapper/contracts'
import logger from '../../shared/logger'
import { getDesktopUpdateManifestRequest } from '../../shared/updater/desktopManifestSource'
import { getUpdateSource } from '../../shared/updater/updateSource'
import { acknowledgeActiveRuntime } from '../bootstrapper/runtimeCommands'
import { recordUpdateActivation } from '../updater/updateTelemetry'
import { handoffPreparedUpdate, setLaunchHandoffRuntime } from './launchHandoff'
import { updateCoordinator } from './updateCoordinator'

import type { BootstrapperRuntimePaths } from '../../shared/bootstrapper/paths'
import type { BootstrapWindowController } from './bootstrapWindow'
import type { LaunchInbox } from './launchInbox'
import type { LaunchQueue } from './launchQueue'
import type { ActiveRuntimeV3 } from '@common/desktopRuntime/contract'
import type { BootstrapUiController } from '@common/types/bootstrapEvents'

export type ApplicationStartupHandle = {
    deliverLaunchRequest(request: LaunchRequestEnvelopeV1): Promise<boolean>
    ready: Promise<void>
}

export type ApplicationBootstrapRuntime = {
    bootstrapUi?: BootstrapUiController
    activeRuntime: ActiveRuntimeV3
    getLastCheckAt(): number | null
    handoffPreparedUpdate(): Promise<boolean>
    leaseId: string
    runUpdate(options: Parameters<typeof updateCoordinator.run>[0]): ReturnType<typeof updateCoordinator.run>
}

export type ApplicationMainLoader = (
    bootstrapWindow: BrowserWindow,
    bootstrapRuntime: ApplicationBootstrapRuntime,
    activeRuntime: ActiveRuntimeV3,
) => Promise<ApplicationStartupHandle>

export class StartupCoordinator {
    private applicationHandle: ApplicationStartupHandle | null = null
    private gatePromise: Promise<void> | null = null
    private unsubscribeState: (() => void) | null = null

    public constructor(
        private readonly options: {
            bootstrapWindow: BootstrapWindowController
            activeRuntime: ActiveRuntimeV3
            inbox: LaunchInbox
            lease: ActiveAppLeaseV1
            loadApplicationMain: ApplicationMainLoader
            onStartupFailure(error: unknown): Promise<void>
            queue: LaunchQueue
            runtimePaths: BootstrapperRuntimePaths
        },
    ) {
        this.unsubscribeState = updateCoordinator.subscribe(state => {
            options.bootstrapWindow.publish(state)
        })
        options.bootstrapWindow.setActionHandlers({
            retry: async () => {
                if (this.gatePromise || this.applicationHandle) return false
                void this.runGate()
                return true
            },
            continue: async () => {
                if (this.applicationHandle) return false
                try {
                    options.bootstrapWindow.publish({
                        schemaVersion: 1,
                        phase: 'launching',
                        statusKey: 'launching-client',
                        progress: { kind: 'indeterminate' },
                        actions: [],
                    })
                    await this.startApplication()
                    return true
                } catch (error) {
                    await options.onStartupFailure(error)
                    return false
                }
            },
        })
        setLaunchHandoffRuntime({
            inbox: options.inbox,
            lease: options.lease,
            queue: options.queue,
            runtimePaths: options.runtimePaths,
        })
    }

    public run(): Promise<void> {
        return this.runGate()
    }

    public async runWithoutUpdate(): Promise<void> {
        this.options.bootstrapWindow.publish({
            schemaVersion: 1,
            phase: 'error',
            statusKey: 'launch-failed',
            progress: { kind: 'indeterminate' },
            actions: ['retry', 'continue'],
        })
    }

    private runGate(): Promise<void> {
        if (this.gatePromise) return this.gatePromise
        const operation = this.executeGate()
            .catch(error => this.options.onStartupFailure(error))
            .finally(() => {
                if (this.gatePromise === operation) this.gatePromise = null
            })
        this.gatePromise = operation
        return operation
    }

    private async executeGate(): Promise<void> {
        const launcher = this.options.runtimePaths.launcher
        if (!launcher) throw new Error('Bootstrapper launcher was not found')
        const request = getDesktopUpdateManifestRequest({ source: getUpdateSource() })
        let result: PrepareUpdateResultV1
        try {
            result = await updateCoordinator.run({
                activeLeaseId: this.options.lease.leaseId,
                appExecutableName: this.options.runtimePaths.appExecutableName,
                channel: request.channel,
                dist: request.dist,
                stateRoot: this.options.runtimePaths.stateRoot,
                hostBundle: this.options.runtimePaths.hostBundle,
                appExecutable: this.options.runtimePaths.appExecutable,
                installedVersion: this.options.activeRuntime.coreVersion,
                launcher,
                manifestUrl: request.manifestUrl,
                requestedSource: request.requestedSource,
                retainAppVersions: 2,
                serverHealthUrl: request.serverHealthUrl,
                onDiagnostic: line => logger.updater.warn('Bootstrapper diagnostic', line),
            })
        } catch (error) {
            logger.updater.error('Bootstrap update gate failed', error)
            return
        }
        await this.handleResult(result)
    }

    private async handleResult(result: PrepareUpdateResultV1): Promise<void> {
        if (result.state === 'up-to-date') {
            await this.startApplication()
            return
        }
        if (result.state === 'prepared') {
            const handedOff = await handoffPreparedUpdate()
            if (!handedOff) {
                this.options.bootstrapWindow.publish({
                    schemaVersion: 1,
                    phase: 'error',
                    statusKey: 'update-failed',
                    progress: { kind: 'indeterminate' },
                    actions: ['retry', 'continue'],
                })
            }
            return
        }
        logger.updater.error('Bootstrap update preparation blocked', {
            block: result.block,
            decision: result.decision,
            source: result.source,
        })
    }

    private async startApplication(): Promise<void> {
        if (this.applicationHandle) return
        const launcher = this.options.runtimePaths.launcher
        if (!launcher) throw new Error('Bootstrapper launcher was not found')
        const activeRuntime = this.options.activeRuntime
        const handle = await this.options.loadApplicationMain(
            this.options.bootstrapWindow.window,
            {
                activeRuntime,
                bootstrapUi: this.options.bootstrapWindow,
                leaseId: this.options.lease.leaseId,
                getLastCheckAt: () => updateCoordinator.lastCheckAt,
                runUpdate: options => updateCoordinator.run(options),
                handoffPreparedUpdate,
            },
            activeRuntime,
        )
        this.applicationHandle = handle
        await this.options.inbox.start(request => handle.deliverLaunchRequest(request))
        await handle.ready
        if (activeRuntime.activationState === 'pending') {
            const activationStartedAt = Date.now()
            try {
                await acknowledgeActiveRuntime({
                    activeLeaseId: this.options.lease.leaseId,
                    generation: activeRuntime.generation,
                    hostBundle: this.options.runtimePaths.hostBundle,
                    launcher,
                    stateRoot: this.options.runtimePaths.stateRoot,
                })
                recordUpdateActivation('acknowledged', Math.max(0, Date.now() - activationStartedAt))
            } catch (error) {
                recordUpdateActivation('failed', Math.max(0, Date.now() - activationStartedAt))
                throw error
            }
        }
        this.unsubscribeState?.()
        this.unsubscribeState = null
    }
}
