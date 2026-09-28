import fs from 'node:fs'
import path from 'node:path'

import { ackLaunchRequest, claimLaunchRequests, enqueueLaunchRequest } from '../bootstrapper/runtimeCommands'
import { captureMainException } from '../errorTracking'
import logger from '../logger'

import type { ActiveAppLeaseV1, LaunchRequestEnvelopeV1, LaunchRequestInputV1 } from '../bootstrapper/contracts'
import type { BootstrapperLauncher } from '../bootstrapper/paths'

export type LaunchRequestDelivery = (request: LaunchRequestEnvelopeV1) => Promise<boolean>

export class LaunchInbox {
    private delivery: LaunchRequestDelivery | null = null
    private frozen = false
    private reconcilePromise: Promise<void> | null = null
    private watcher: fs.FSWatcher | null = null
    private pollTimer: NodeJS.Timeout | null = null
    private pollPromise: Promise<void> | null = null
    private reportedBackgroundError: string | null = null

    public constructor(
        private readonly options: {
            stateRoot: string
            launcher: BootstrapperLauncher
            lease: ActiveAppLeaseV1
        },
    ) {}

    public async enqueue(input: LaunchRequestInputV1): Promise<void> {
        await enqueueLaunchRequest({
            activeLeaseId: this.options.lease.leaseId,
            input,
            stateRoot: this.options.stateRoot,
            launcher: this.options.launcher,
        })
        this.runInBackground(() => this.reconcile())
    }

    public async start(delivery: LaunchRequestDelivery): Promise<void> {
        this.delivery = delivery
        this.frozen = false
        this.startWatcher()
        await this.reconcile()
    }

    public freeze(): void {
        this.frozen = true
        this.closeWatcher()
    }

    public async unfreeze(): Promise<void> {
        if (!this.delivery) return
        this.frozen = false
        this.startWatcher()
        await this.reconcile()
    }

    public stop(): void {
        this.delivery = null
        this.closeWatcher()
    }

    public reconcile(): Promise<void> {
        if (!this.delivery || this.frozen) return Promise.resolve()
        if (this.reconcilePromise) return this.reconcilePromise
        this.reconcilePromise = this.reconcileAll().finally(() => {
            this.reconcilePromise = null
        })
        return this.reconcilePromise
    }

    private async reconcileAll(): Promise<void> {
        while (this.delivery && !this.frozen) {
            const result = await claimLaunchRequests({
                activeLeaseId: this.options.lease.leaseId,
                stateRoot: this.options.stateRoot,
                launcher: this.options.launcher,
                limit: 64,
            })
            const requests = [...result.requests].sort((left, right) => left.sequence - right.sequence)
            if (requests.length === 0) return
            for (const request of requests) {
                if (!this.delivery || this.frozen || !(await this.delivery(request))) return
                await ackLaunchRequest({
                    activeLeaseId: this.options.lease.leaseId,
                    stateRoot: this.options.stateRoot,
                    launcher: this.options.launcher,
                    requestId: request.id,
                })
            }
            if (requests.length < 64) return
        }
    }

    private startWatcher(): void {
        this.closeWatcher()
        const inboxDir = path.join(this.options.stateRoot, 'runtime', 'launch-inbox', this.options.lease.inboxId)
        try {
            this.watcher = fs.watch(inboxDir, () => this.runInBackground(() => this.reconcile()))
        } catch {
            this.watcher = null
        }
        this.pollTimer = setInterval(() => this.runInBackground(() => this.poll(inboxDir)), 1_000)
        this.pollTimer.unref()
    }

    private runInBackground(task: () => Promise<void>): void {
        void task()
            .then(() => {
                this.reportedBackgroundError = null
            })
            .catch(error => {
                const normalizedError = error instanceof Error ? error : new Error(String(error))
                const signature = `${normalizedError.name}:${normalizedError.message}`
                if (signature === this.reportedBackgroundError) return

                this.reportedBackgroundError = signature
                logger.main.error('Launch inbox background reconciliation failed', normalizedError)
                captureMainException(normalizedError, 'LaunchInbox/background-reconcile')
            })
    }

    private poll(inboxDir: string): Promise<void> {
        if (!this.delivery || this.frozen) return Promise.resolve()
        if (this.pollPromise) return this.pollPromise
        this.pollPromise = this.reconcileIfPending(inboxDir).finally(() => {
            this.pollPromise = null
        })
        return this.pollPromise
    }

    private async reconcileIfPending(inboxDir: string): Promise<void> {
        try {
            const entries = await fs.promises.readdir(inboxDir, { withFileTypes: true })
            const hasPendingRequest = entries.some(entry => entry.isFile() && entry.name !== 'state.json' && entry.name.endsWith('.json'))
            if (!hasPendingRequest) return
        } catch {
            // Let the authoritative bootstrapper validate or recreate the inbox when the cheap local check fails.
        }
        await this.reconcile()
    }

    private closeWatcher(): void {
        this.watcher?.close()
        this.watcher = null
        if (this.pollTimer) clearInterval(this.pollTimer)
        this.pollTimer = null
    }
}
