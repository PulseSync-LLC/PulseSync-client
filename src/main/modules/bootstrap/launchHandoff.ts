import { app } from 'electron'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'
import logger from '../logger'
import type { ActiveAppLeaseV1 } from '../bootstrapper/contracts'
import { claimActiveApp } from '../bootstrapper/runtimeCommands'
import type { BootstrapperRuntimePaths } from '../bootstrapper/paths'
import { relaunchThroughBootstrapper } from '../bootstrapper/relaunch'
import type { LaunchInbox } from './launchInbox'
import type { LaunchQueue } from './launchQueue'

export type LaunchHandoffRuntime = {
    inbox: LaunchInbox
    lease: ActiveAppLeaseV1
    publishState?: (state: BootstrapUiStateV1) => void
    queue: LaunchQueue
    runtimePaths: BootstrapperRuntimePaths
}

let activeRuntime: LaunchHandoffRuntime | null = null
let activeHandoff: Promise<boolean> | null = null

export function setLaunchHandoffRuntime(runtime: LaunchHandoffRuntime): void {
    activeRuntime = runtime
}

export function getActiveAppLease(): ActiveAppLeaseV1 | null {
    return activeRuntime?.lease ?? null
}

export function handoffPreparedUpdate(): Promise<boolean> {
    if (activeHandoff) return activeHandoff
    if (!activeRuntime) return Promise.resolve(false)
    const operation = performHandoff(activeRuntime).finally(() => {
        if (activeHandoff === operation) activeHandoff = null
    })
    activeHandoff = operation
    return operation
}

async function performHandoff(runtime: LaunchHandoffRuntime): Promise<boolean> {
    const launcher = runtime.runtimePaths.launcher
    if (!launcher) return false

    runtime.inbox.freeze()
    await runtime.queue.flush()
    runtime.publishState?.({
        schemaVersion: 1,
        phase: 'restarting',
        statusKey: 'restarting-client',
        progress: { kind: 'indeterminate' },
        actions: [],
    })

    try {
        const armed = await relaunchThroughBootstrapper({
            activeLeaseId: runtime.lease.leaseId,
            appExecutable: runtime.runtimePaths.appExecutable,
            appExecutableName: runtime.runtimePaths.appExecutableName,
            installRoot: runtime.runtimePaths.installRoot,
            launcher,
            waitForPid: process.pid,
            onDiagnostic: line => logger.updater.warn('Bootstrapper handoff diagnostic', line),
        })
        logger.updater.info('Bootstrapper handoff armed', { handoffId: armed.handoffId, rustPid: armed.rustPid })
        scheduleHandoffRecovery(runtime)
        app.quit()
        return true
    } catch (error) {
        logger.updater.error('Bootstrapper handoff failed before arming', error)
        await runtime.inbox.unfreeze().catch(recoveryError => logger.updater.error('Failed to resume launch inbox', recoveryError))
        return false
    }
}

function scheduleHandoffRecovery(runtime: LaunchHandoffRuntime): void {
    const timer = setTimeout(() => {
        void recoverTimedOutHandoff(runtime)
    }, 65_000)
    timer.unref()
}

async function recoverTimedOutHandoff(runtime: LaunchHandoffRuntime): Promise<void> {
    if (!app.isReady()) return
    const launcher = runtime.runtimePaths.launcher
    if (!launcher) return
    try {
        const result = await claimActiveApp({
            installRoot: runtime.runtimePaths.installRoot,
            appExecutable: runtime.runtimePaths.appExecutable,
            launcher,
            expectedLeaseId: runtime.lease.leaseId,
        })
        if (result.state !== 'claimed' || result.lease.leaseId !== runtime.lease.leaseId) {
            logger.updater.error('Bootstrapper handoff recovery was not confirmed', result)
            return
        }
        runtime.lease = result.lease
        await runtime.inbox.unfreeze()
        logger.updater.warn('Bootstrapper handoff timed out; current application lease was restored')
    } catch (error) {
        logger.updater.error('Bootstrapper handoff timeout recovery failed', error)
    }
}
