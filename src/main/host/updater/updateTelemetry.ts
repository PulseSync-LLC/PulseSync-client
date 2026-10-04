import { BootstrapperCommandError } from '../../shared/bootstrapper/command'
import { isUpdateErrorV1, type PrepareUpdateResultV1 } from '../../shared/bootstrapper/contracts'
import { addMainBreadcrumb, addMainLog } from '../../shared/errorTracking'
import logger from '../../shared/logger'

import type { PrepareDesktopUpdateOptions } from '../../shared/updater/bootstrapperUpdateService'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

type UpdateTelemetryContext = Pick<PrepareDesktopUpdateOptions, 'channel' | 'dist' | 'requestedSource'>
function baseAttributes(context: UpdateTelemetryContext): Record<string, string | number | boolean> {
    return {
        channel: context.channel,
        dist: context.dist,
        requested_source: context.requestedSource,
    }
}

function updateErrorCode(error: unknown): string {
    if (!(error instanceof BootstrapperCommandError) || !isUpdateErrorV1(error.result)) return 'unknown'
    return error.result.error.code || `exit-${error.exitCode ?? 'unknown'}`
}

function recordDeliveryTelemetry(result: Extract<PrepareUpdateResultV1, { state: 'prepared' }>, context: UpdateTelemetryContext): void {
    const telemetry = result.deliveryTelemetry
    if (!telemetry) return

    const downloadedBytes = telemetry.artifacts.reduce((total, artifact) => total + artifact.downloadedBytes, 0)
    const deltaAttempts = telemetry.artifacts.reduce(
        (total, artifact) => total + artifact.deltaAttempts.reduce((artifactTotal, attempt) => artifactTotal + attempt.count, 0),
        0,
    )
    const deltaFailures = telemetry.artifacts.reduce(
        (total, artifact) =>
            total + artifact.deltaAttempts.reduce((artifactTotal, attempt) => artifactTotal + (attempt.outcome === 'applied' ? 0 : attempt.count), 0),
        0,
    )
    const attributes = baseAttributes(context)
    logger.updater.info('Bootstrapper update delivery telemetry', {
        ...telemetry,
        downloadedBytes,
    })
    addMainBreadcrumb('pulsesync.updater.delivery', 'Update payload prepared', {
        ...attributes,
        targetVersion: result.decision.targetVersion,
        durationMs: telemetry.durationMs,
        downloadedBytes,
        deltaAttempts,
        deltaFailures,
    })
}

export function recordUpdatePrepareResult(result: PrepareUpdateResultV1, context: UpdateTelemetryContext, durationMs: number): void {
    const attributes = {
        ...baseAttributes(context),
        outcome: result.state,
        ...(result.state === 'prepared' ? { reused: result.reused } : {}),
        ...(result.state === 'blocked' ? { block_code: result.block.code } : {}),
    }
    addMainBreadcrumb('pulsesync.updater.prepare', `Update preparation ${result.state}`, {
        ...attributes,
        durationMs,
        targetVersion: result.decision?.targetVersion,
        blockCode: result.state === 'blocked' ? result.block.code : undefined,
    })
    if (result.state === 'blocked') {
        addMainLog('warn', `Update preparation blocked: ${result.block.code}`, {
            ...attributes,
            durationMs,
            targetVersion: result.decision?.targetVersion,
        })
    }
    if (result.state === 'prepared') recordDeliveryTelemetry(result, context)
}

export function recordUpdatePrepareFailure(error: unknown, context: UpdateTelemetryContext, durationMs: number): void {
    const errorCode = updateErrorCode(error)
    const attributes = {
        ...baseAttributes(context),
        outcome: 'failed',
        error_code: errorCode,
    }
    addMainLog('error', `Update preparation failed: ${errorCode}`, {
        ...attributes,
        durationMs,
        error_message: error instanceof Error ? error.message : String(error),
    })
    addMainBreadcrumb('pulsesync.updater.prepare', 'Update preparation failed', {
        ...attributes,
        durationMs,
    })
}

export function recordUpdateTransition(previous: BootstrapUiStateV1, next: BootstrapUiStateV1, context?: UpdateTelemetryContext): void {
    if (previous.phase === next.phase && previous.statusKey === next.statusKey) return
    const attributes = {
        ...(context ? baseAttributes(context) : {}),
        from_phase: previous.phase,
        to_phase: next.phase,
        status: next.statusKey,
    }
    addMainBreadcrumb('pulsesync.updater.transition', 'Updater state transition', attributes)
}

export function recordUpdateHandoff(outcome: 'armed' | 'failed' | 'launcher-missing', durationMs: number): void {
    if (outcome !== 'armed') {
        addMainLog('error', outcome === 'launcher-missing' ? 'Update restart failed: bootstrapper launcher missing' : 'Update restart failed', {
            outcome,
            durationMs,
        })
    }
    addMainBreadcrumb('pulsesync.updater.handoff', `Updater handoff ${outcome}`, {
        outcome,
        durationMs,
    })
}

export function recordUpdateActivation(outcome: 'acknowledged' | 'failed', durationMs: number): void {
    logger.updater.info('Updated runtime activation telemetry', { outcome, durationMs })
    addMainLog(
        outcome === 'acknowledged' ? 'info' : 'error',
        outcome === 'acknowledged' ? `Update activated in ${durationMs} ms` : `Update activation failed after ${durationMs} ms`,
        { outcome, durationMs },
    )
    addMainBreadcrumb('pulsesync.updater.activation', `Updated runtime activation ${outcome}`, {
        outcome,
        durationMs,
    })
}
