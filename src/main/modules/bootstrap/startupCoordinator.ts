import { app, type BrowserWindow } from 'electron'

import { BootstrapperCommandError } from '../bootstrapper/command'
import { type ActiveAppLeaseV1, isUpdateErrorV1, type LaunchRequestEnvelopeV1, type PrepareUpdateResultV1 } from '../bootstrapper/contracts'
import { acknowledgeActiveRuntime } from '../bootstrapper/runtimeCommands'
import logger from '../logger'
import { getDesktopUpdateManifestRequest } from '../updater/desktopManifestSource'
import { getUpdateSource } from '../updater/updateSource'
import { handoffPreparedUpdate,setLaunchHandoffRuntime } from './launchHandoff'
import { updateCoordinator } from './updateCoordinator'

import type { BootstrapperRuntimePaths } from '../bootstrapper/paths'
import type { BootstrapWindowController } from './bootstrapWindow'
import type { LaunchInbox } from './launchInbox'
import type { LaunchQueue } from './launchQueue'
import type { ActiveRuntimeV3 } from '@common/desktopRuntime/contract'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

export type ApplicationStartupHandle = {
    deliverLaunchRequest(request: LaunchRequestEnvelopeV1): Promise<boolean>
    ready: Promise<void>
}

export type ApplicationBootstrapRuntime = {
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
            queue: LaunchQueue
            runtimePaths: BootstrapperRuntimePaths
        },
    ) {
        this.unsubscribeState = updateCoordinator.subscribe(state => {
            const canStartApplication = state.actions.includes('continue')
            if ((state.phase === 'error' || state.phase === 'blocked') && canStartApplication) {
                options.bootstrapWindow.publish({
                    schemaVersion: 1,
                    phase: 'launching',
                    statusKey: 'launching-client',
                    progress: { kind: 'indeterminate' },
                    actions: [],
                })
                return
            }
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

    public runWithoutUpdate(): Promise<void> {
        return this.startApplicationAfterFailure()
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
                installedVersion: this.options.activeRuntime.coreVersion,
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
        logger.updater.error('Bootstrap update preparation blocked', {
            block: result.block,
            decision: result.decision,
            source: result.source,
        })
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
        const launcher = this.options.runtimePaths.launcher
        if (!launcher) throw new Error('Bootstrapper launcher was not found')
        const activeRuntime = this.options.activeRuntime
        const handle = await this.options.loadApplicationMain(
            this.options.bootstrapWindow.window,
            {
                activeRuntime,
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
            await acknowledgeActiveRuntime({
                activeLeaseId: this.options.lease.leaseId,
                generation: activeRuntime.generation,
                hostBundle: this.options.runtimePaths.hostBundle,
                launcher,
                stateRoot: this.options.runtimePaths.stateRoot,
            })
        }
        this.unsubscribeState?.()
        this.unsubscribeState = null
    }

    private isSafeToContinue(error: unknown): boolean {
        if (!(error instanceof BootstrapperCommandError) || !isUpdateErrorV1(error.result)) return false
        return error.result.error.safeToContinue
    }
}
