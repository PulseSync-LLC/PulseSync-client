import type { BootstrapAction, BootstrapUiStateV1 } from '@common/types/bootstrapEvents'
import { BootstrapperCommandError } from '../bootstrapper/command'
import { isUpdateErrorV1, type PrepareUpdateResultV1, type RustUpdateProgressEventV1 } from '../bootstrapper/contracts'

function actionsFor(retryable: boolean, safeToContinue: boolean): BootstrapAction[] {
    const actions: BootstrapAction[] = []
    if (safeToContinue) actions.push('continue')
    if (retryable) actions.push('retry')
    return actions
}

function progressFor(event: RustUpdateProgressEventV1): BootstrapUiStateV1['progress'] {
    if (
        event.event === 'artifact-progress' &&
        typeof event.bytesRead === 'number' &&
        typeof event.bytesTotal === 'number' &&
        event.bytesTotal > 0 &&
        event.bytesRead <= event.bytesTotal
    ) {
        return { kind: 'bytes', read: event.bytesRead, total: event.bytesTotal }
    }
    return { kind: 'indeterminate' }
}

export function bootstrapUiStateFromProgress(event: RustUpdateProgressEventV1): BootstrapUiStateV1 {
    if (event.stage === 'downloading') {
        const modules = event.artifactKey?.startsWith('module:') === true
        return {
            schemaVersion: 1,
            phase: modules ? 'downloading-modules' : 'downloading-app',
            statusKey: modules ? 'downloading-modules' : 'downloading-client',
            progress: progressFor(event),
            actions: [],
        }
    }
    if (event.stage === 'planning' || event.stage === 'preparing') {
        return {
            schemaVersion: 1,
            phase: 'preparing',
            statusKey: event.stage === 'planning' ? 'planning-update' : 'preparing-update',
            progress: { kind: 'indeterminate' },
            actions: [],
        }
    }
    if (event.stage === 'prepared') {
        return { schemaVersion: 1, phase: 'restarting', statusKey: 'restarting-client', progress: { kind: 'indeterminate' }, actions: [] }
    }
    if (event.stage === 'up-to-date') {
        return { schemaVersion: 1, phase: 'launching', statusKey: 'launching-client', progress: { kind: 'indeterminate' }, actions: [] }
    }
    if (event.stage === 'blocked') {
        return { schemaVersion: 1, phase: 'blocked', statusKey: 'update-blocked', progress: { kind: 'indeterminate' }, actions: [] }
    }
    return { schemaVersion: 1, phase: 'checking', statusKey: 'checking-for-updates', progress: { kind: 'indeterminate' }, actions: [] }
}

export function bootstrapUiStateFromPrepareResult(result: PrepareUpdateResultV1): BootstrapUiStateV1 {
    if (result.state === 'prepared') {
        return { schemaVersion: 1, phase: 'restarting', statusKey: 'restarting-client', progress: { kind: 'indeterminate' }, actions: [] }
    }
    if (result.state === 'up-to-date') {
        return { schemaVersion: 1, phase: 'launching', statusKey: 'launching-client', progress: { kind: 'indeterminate' }, actions: [] }
    }
    return {
        schemaVersion: 1,
        phase: 'blocked',
        statusKey: 'update-blocked',
        progress: { kind: 'indeterminate' },
        actions: actionsFor(result.block.retryable, result.block.safeToContinue),
    }
}

export function bootstrapUiStateFromError(error: unknown): BootstrapUiStateV1 {
    const result = error instanceof BootstrapperCommandError ? error.result : undefined
    const updateError = isUpdateErrorV1(result) ? result : undefined
    return {
        schemaVersion: 1,
        phase: 'error',
        statusKey: 'update-failed',
        progress: { kind: 'indeterminate' },
        actions: updateError ? actionsFor(updateError.error.retryable, updateError.error.safeToContinue) : [],
    }
}
