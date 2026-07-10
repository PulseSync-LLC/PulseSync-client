import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'
import {
    prepareDesktopUpdate,
    type PrepareDesktopUpdateOptions,
    type PrepareUpdateResultV1,
} from '../updater/bootstrapperUpdateService'
import { bootstrapUiStateFromError, bootstrapUiStateFromPrepareResult } from './updateUiState'

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
    private continueHandler: (() => Promise<boolean>) | null = null
    private lastOptions: PrepareDesktopUpdateOptions | null = null
    private listeners = new Set<BootstrapStateListener>()
    private state: BootstrapUiStateV1 = INITIAL_STATE

    public lastCheckAt: number | null = null

    public get active(): boolean {
        return this.activeOperation !== null
    }

    public get currentState(): BootstrapUiStateV1 {
        return this.state
    }

    public subscribe(listener: BootstrapStateListener): () => void {
        this.listeners.add(listener)
        listener(this.state)
        return () => this.listeners.delete(listener)
    }

    public setContinueHandler(handler: (() => Promise<boolean>) | null): void {
        this.continueHandler = handler
    }

    public run(options: PrepareDesktopUpdateOptions): Promise<PrepareUpdateResultV1> {
        if (this.activeOperation) {
            return this.activeOperation
        }
        this.lastOptions = options
        this.publish(INITIAL_STATE)
        const onProgress = options.onProgress
        const operation = prepareDesktopUpdate({
            ...options,
            onProgress: (event, uiState) => {
                this.publish(uiState)
                onProgress?.(event, uiState)
            },
        })
            .then(result => {
                this.publish(bootstrapUiStateFromPrepareResult(result))
                return result
            })
            .catch(error => {
                this.publish(bootstrapUiStateFromError(error))
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

    public retry(): boolean {
        if (!this.state.actions.includes('retry') || !this.lastOptions || this.activeOperation) {
            return false
        }
        void this.run(this.lastOptions).catch(() => undefined)
        return true
    }

    public async continue(): Promise<boolean> {
        if (!this.state.actions.includes('continue') || !this.continueHandler) {
            return false
        }
        return await this.continueHandler()
    }

    private publish(state: BootstrapUiStateV1): void {
        this.state = state
        for (const listener of this.listeners) {
            listener(state)
        }
    }
}

export const updateCoordinator = new UpdateCoordinator()
