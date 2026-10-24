import { type BrowserWindow } from 'electron'

import { BootstrapperCommandError } from '../../shared/bootstrapper/command'
import { type ActiveAppLeaseV1, isUpdateErrorV1, type LaunchRequestEnvelopeV1, type PrepareUpdateResultV1 } from '../../shared/bootstrapper/contracts'
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
            if (state.phase === 'error' || state.phase === 'blocked') {
                this.publishRecovery()
                return
            }
            options.bootstrapWindow.publish({ ...state, actions: [] })
        })
        options.bootstrapWindow.setActionHandlers({})
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
        try {
            this.publishRecovery()
            await this.startApplication()
        } catch (error) {
            await this.options.onStartupFailure(error)
        }
    }

    private publishRecovery(): void {
        this.options.bootstrapWindow.show()
        this.options.bootstrapWindow.publish({
            schemaVersion: 1,
            phase: 'launching',
            statusKey: 'launching-client',
            progress: { kind: 'indeterminate' },
            actions: [],
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
        // A newly activated runtime must reach UI readiness before its native acknowledgement deadline.
        if (this.options.activeRuntime.activationState === 'pending') {
            await this.startApplication()
            return
        }
        const launcher = this.options.runtimePaths.launcher
        if (!launcher) throw new Error('Bootstrapper launcher was not found')
        const request = getDesktopUpdateManifestRequest({ source: getUpdateSource() })
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            let result: PrepareUpdateResultV1 | undefined
            let failure: unknown
            let retryable = false
            let safeToContinue = false
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
                failure = error
                const commandResult = error instanceof BootstrapperCommandError ? error.result : undefined
                if (isUpdateErrorV1(commandResult)) {
                    retryable = commandResult.error.retryable
                    safeToContinue = commandResult.error.safeToContinue
                }
            }
            if (result?.state === 'up-to-date') {
                await this.startApplication()
                return
            }
            if (result?.state === 'prepared') {
                if (await handoffPreparedUpdate()) return
                // Arming may expire a failed transaction; prepare it again before another handoff.
                failure = new Error('Bootstrapper handoff failed before arming')
                retryable = true
            }
            if (result?.state === 'blocked') {
                failure = new Error(`Bootstrap update blocked: ${result.block.code}`, { cause: result })
                retryable = result.block.retryable
                safeToContinue = result.block.safeToContinue
            }
            logger.updater.warn('Bootstrap update attempt failed', { attempt, retryable, safeToContinue, error: failure })
            if (retryable && attempt < 3) {
                this.publishRecovery()
                await new Promise(resolve => setTimeout(resolve, attempt * 1000))
                continue
            }
            if (safeToContinue) {
                logger.updater.warn('Starting installed runtime after unsuccessful update check')
                this.publishRecovery()
                await this.startApplication()
                return
            }
            throw failure ?? new Error('Bootstrap update returned no result')
        }
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
