import { bootstrapUiStateFromError, bootstrapUiStateFromPrepareResult } from '../../shared/bootstrap/updateUiState'
import { prepareDesktopUpdate, type PrepareDesktopUpdateOptions, type PrepareUpdateResultV1 } from '../../shared/updater/bootstrapperUpdateService'
import { recordUpdatePrepareFailure, recordUpdatePrepareResult, recordUpdateTransition } from '../updater/updateTelemetry'

import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

export type BootstrapStateListener = (state: BootstrapUiStateV1) => void

const INITIAL_STATE: BootstrapUiStateV1 = {
    schemaVersion: 1,
    phase: 'checking',
    statusKey: 'checking-for-updates',
    progress: { kind: 'indeterminate' },
    actions: [],
}

export class UpdateCoordinator {
    private activeOperation: Promise<PrepareUpdateResultV1> | null = null
    private lastOptions: PrepareDesktopUpdateOptions | null = null
    private listeners = new Set<BootstrapStateListener>()
    private state: BootstrapUiStateV1 = INITIAL_STATE

    public lastCheckAt: number | null = null

    public subscribe(listener: BootstrapStateListener): () => void {
        this.listeners.add(listener)
        listener(this.state)
        return () => this.listeners.delete(listener)
    }

    public run(options: PrepareDesktopUpdateOptions): Promise<PrepareUpdateResultV1> {
        if (this.activeOperation) {
            return this.activeOperation
        }
        this.lastOptions = options
        this.publish(INITIAL_STATE)
        const startedAt = Date.now()
        const onProgress = options.onProgress
        const operation = prepareDesktopUpdate({
            ...options,
            onProgress: (event, uiState) => {
                this.publish(uiState)
                onProgress?.(event, uiState)
            },
        })
            .then(result => {
                recordUpdatePrepareResult(result, options, Math.max(0, Date.now() - startedAt))
                this.publish(bootstrapUiStateFromPrepareResult(result))
                return result
            })
            .catch(error => {
                recordUpdatePrepareFailure(error, options, Math.max(0, Date.now() - startedAt))
                this.publish(bootstrapUiStateFromError())
                throw error
            })
            .finally(() => {
                this.lastCheckAt = Date.now()
                if (this.activeOperation === operation) {
                    this.activeOperation = null
                }
            })
        this.activeOperation = operation
        return operation
    }

    private publish(state: BootstrapUiStateV1): void {
        recordUpdateTransition(this.state, state, this.lastOptions ?? undefined)
        this.state = state
        for (const listener of this.listeners) {
            listener(state)
        }
    }
}

export const updateCoordinator = new UpdateCoordinator()
