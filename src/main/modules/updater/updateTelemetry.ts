import { BootstrapperCommandError } from '../bootstrapper/command'
import { isUpdateErrorV1, type PrepareUpdateResultV1 } from '../bootstrapper/contracts'
import { addMainBreadcrumb, countMainMetric, distributeMainMetric } from '../errorTracking'
import logger from '../logger'

import type { PrepareDesktopUpdateOptions } from './bootstrapperUpdateService'
import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

type UpdateTelemetryContext = Pick<PrepareDesktopUpdateOptions, 'channel' | 'dist' | 'requestedSource'>
type MetricAttributes = Record<string, string | number | boolean>

function baseAttributes(context: UpdateTelemetryContext): MetricAttributes {
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
            total +
            artifact.deltaAttempts.reduce(
                (artifactTotal, attempt) => artifactTotal + (attempt.outcome === 'applied' ? 0 : attempt.count),
                0,
            ),
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
    distributeMainMetric('pulsesync.updater.payload_download_bytes', downloadedBytes, 'byte', attributes)
    distributeMainMetric('pulsesync.updater.payload_prepare_duration', telemetry.durationMs, 'millisecond', attributes)

    for (const artifact of telemetry.artifacts) {
        countMainMetric('pulsesync.updater.artifact_delivery', 1, {
            ...attributes,
            artifact: artifact.key,
            delivery: artifact.delivery,
            reused: artifact.reused,
        })
        if (artifact.fallbackReason) {
            countMainMetric('pulsesync.updater.fallback', 1, {
                ...attributes,
                artifact: artifact.key,
                reason: artifact.fallbackReason,
                scope: 'artifact',
            })
        }
        for (const delivery of artifact.fileDeliveries) {
            countMainMetric('pulsesync.updater.file_delivery', delivery.count, {
                ...attributes,
                artifact: artifact.key,
                delivery: delivery.delivery,
            })
        }
        for (const fallback of artifact.fallbacks) {
            countMainMetric('pulsesync.updater.fallback', fallback.count, {
                ...attributes,
                artifact: artifact.key,
                reason: fallback.reason,
                scope: 'file',
            })
        }
        for (const attempt of artifact.deltaAttempts) {
            const deltaAttributes = {
                ...attributes,
                artifact: artifact.key,
                provider: attempt.provider,
                outcome: attempt.outcome,
                reason: attempt.reason ?? 'none',
            }
            countMainMetric('pulsesync.updater.delta_attempt', attempt.count, deltaAttributes)
            distributeMainMetric('pulsesync.updater.delta_download_bytes', attempt.downloadBytes, 'byte', deltaAttributes)
            distributeMainMetric('pulsesync.updater.delta_duration', attempt.durationMs, 'millisecond', deltaAttributes)
        }
    }
}

export function recordUpdatePrepareResult(
    result: PrepareUpdateResultV1,
    context: UpdateTelemetryContext,
    durationMs: number,
): void {
    const attributes = {
        ...baseAttributes(context),
        outcome: result.state,
        ...(result.state === 'prepared' ? { reused: result.reused } : {}),
        ...(result.state === 'blocked' ? { block_code: result.block.code } : {}),
    }
    countMainMetric('pulsesync.updater.prepare', 1, attributes)
    distributeMainMetric('pulsesync.updater.prepare_duration', durationMs, 'millisecond', attributes)
    addMainBreadcrumb('pulsesync.updater.prepare', `Update preparation ${result.state}`, {
        ...attributes,
        durationMs,
        targetVersion: result.decision?.targetVersion,
        blockCode: result.state === 'blocked' ? result.block.code : undefined,
    })
    if (result.state === 'prepared') recordDeliveryTelemetry(result, context)
}

export function recordUpdatePrepareFailure(error: unknown, context: UpdateTelemetryContext, durationMs: number): void {
    const errorCode = updateErrorCode(error)
    const attributes = {
        ...baseAttributes(context),
        outcome: 'failed',
        error_code: errorCode,
    }
    countMainMetric('pulsesync.updater.prepare', 1, attributes)
    distributeMainMetric('pulsesync.updater.prepare_duration', durationMs, 'millisecond', attributes)
    addMainBreadcrumb('pulsesync.updater.prepare', 'Update preparation failed', {
        ...attributes,
        durationMs,
    })
}

export function recordUpdateTransition(
    previous: BootstrapUiStateV1,
    next: BootstrapUiStateV1,
    context?: UpdateTelemetryContext,
): void {
    if (previous.phase === next.phase && previous.statusKey === next.statusKey) return
    const attributes = {
        ...(context ? baseAttributes(context) : {}),
        from_phase: previous.phase,
        to_phase: next.phase,
        status: next.statusKey,
    }
    countMainMetric('pulsesync.updater.transition', 1, attributes)
    addMainBreadcrumb('pulsesync.updater.transition', 'Updater state transition', attributes)
}

export function recordUpdateHandoff(outcome: 'armed' | 'failed' | 'launcher-missing', durationMs: number): void {
    const attributes = { outcome }
    countMainMetric('pulsesync.updater.handoff', 1, attributes)
    distributeMainMetric('pulsesync.updater.handoff_duration', durationMs, 'millisecond', attributes)
    addMainBreadcrumb('pulsesync.updater.handoff', `Updater handoff ${outcome}`, {
        outcome,
        durationMs,
    })
}

export function recordUpdateActivation(outcome: 'acknowledged' | 'failed', durationMs: number): void {
    const attributes = { outcome }
    logger.updater.info('Updated runtime activation telemetry', { outcome, durationMs })
    countMainMetric('pulsesync.updater.activation', 1, attributes)
    distributeMainMetric('pulsesync.updater.activation_duration', durationMs, 'millisecond', attributes)
    addMainBreadcrumb('pulsesync.updater.activation', `Updated runtime activation ${outcome}`, {
        outcome,
        durationMs,
    })
}
