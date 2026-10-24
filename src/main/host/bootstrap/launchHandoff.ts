import { app } from 'electron'

import { captureMainException, flushErrorTracking } from '../../shared/errorTracking'
import logger from '../../shared/logger'
import { getStartupArguments } from '../../shared/startupVisibility'
import { relaunchThroughBootstrapper } from '../bootstrapper/relaunch'
import { claimActiveApp } from '../bootstrapper/runtimeCommands'
import { recordUpdateHandoff } from '../updater/updateTelemetry'

import type { ActiveAppLeaseV1 } from '../../shared/bootstrapper/contracts'
import type { BootstrapperRuntimePaths } from '../../shared/bootstrapper/paths'
import type { LaunchInbox } from './launchInbox'
import type { LaunchQueue } from './launchQueue'

export type LaunchHandoffRuntime = {
    inbox: LaunchInbox
    lease: ActiveAppLeaseV1
    queue: LaunchQueue
    runtimePaths: BootstrapperRuntimePaths
}

let activeRuntime: LaunchHandoffRuntime | null = null
let activeHandoff: Promise<boolean> | null = null

export function setLaunchHandoffRuntime(runtime: LaunchHandoffRuntime): void {
    activeRuntime = runtime
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
    const startedAt = Date.now()
    const launcher = runtime.runtimePaths.launcher
    if (!launcher) {
        recordUpdateHandoff('launcher-missing', Math.max(0, Date.now() - startedAt))
        return false
    }

    let handoffArmed = false
    try {
        runtime.inbox.freeze()
        await runtime.queue.flush()
        const armed = await relaunchThroughBootstrapper({
            activeLeaseId: runtime.lease.leaseId,
            appExecutable: runtime.runtimePaths.appExecutable,
            appExecutableName: runtime.runtimePaths.appExecutableName,
            stateRoot: runtime.runtimePaths.stateRoot,
            hostBundle: runtime.runtimePaths.hostBundle,
            launcher,
            passthrough: getStartupArguments(),
            waitForPid: process.pid,
            onDiagnostic: line => logger.updater.warn('Bootstrapper handoff diagnostic', line),
        })
        handoffArmed = true
        logger.updater.info('Bootstrapper handoff armed', { handoffId: armed.handoffId, rustPid: armed.rustPid })
        recordUpdateHandoff('armed', Math.max(0, Date.now() - startedAt))
        await flushErrorTracking(500).catch(error => logger.updater.warn('Failed to flush handoff diagnostics', error))
        scheduleHandoffRecovery(runtime)
        app.quit()
        return true
    } catch (error) {
        if (handoffArmed) throw error
        recordUpdateHandoff('failed', Math.max(0, Date.now() - startedAt))
        logger.updater.error('Bootstrapper handoff failed before arming', error)
        captureMainException(error, 'bootstrap/handoff')
        await runtime.inbox.unfreeze().catch(recoveryError => {
            logger.updater.error('Failed to resume launch inbox', recoveryError)
            captureMainException(recoveryError, 'bootstrap/handoff-recovery')
        })
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
            stateRoot: runtime.runtimePaths.stateRoot,
            hostBundle: runtime.runtimePaths.hostBundle,
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
