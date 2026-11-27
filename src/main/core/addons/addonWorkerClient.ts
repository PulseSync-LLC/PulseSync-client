import path from 'node:path'
import { Worker } from 'node:worker_threads'

import type {
    AddonValidationOutcome,
    AddonWorkerRequest,
    AddonWorkerRequestMessage,
    AddonWorkerResponseMessage,
    AddonWorkerResult,
} from './workerProtocol'

const IDLE_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 5 * 60_000
const MAX_PENDING_REQUESTS = 64

type PendingRequest = { resolve(result: AddonWorkerResult): void; reject(error: Error): void; timeout: NodeJS.Timeout }
let activeSession: AddonWorkerSession | undefined
let nextRequestId = 1

export class AddonWorkerError extends Error {
    constructor(
        message: string,
        readonly invalidArchive = false,
    ) {
        super(message)
    }
}

class AddonWorkerSession {
    private readonly worker = new Worker(path.join(__dirname, 'addonWorker.cjs'))
    private readonly pending = new Map<number, PendingRequest>()
    private idleTimer?: NodeJS.Timeout
    private closed = false

    constructor() {
        this.worker.on('message', (message: AddonWorkerResponseMessage) => this.handleMessage(message))
        this.worker.once('error', error => {
            void this.close(error)
        })
        this.worker.once('exit', code => {
            if (!this.closed) void this.close(new Error(`Addon worker exited before completing requests (${code})`), false)
        })
        this.worker.unref()
    }

    request(request: AddonWorkerRequest): Promise<AddonWorkerResult> {
        if (this.closed) return Promise.reject(new Error('Addon worker session is closed'))
        if (this.pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new Error('Addon worker request limit reached'))
        clearTimeout(this.idleTimer)
        this.worker.ref()
        const id = nextRequestId++
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                void this.close(new Error('Addon worker request timed out'))
            }, REQUEST_TIMEOUT_MS)
            this.pending.set(id, { resolve, reject, timeout })
            try {
                this.worker.postMessage({ id, request } satisfies AddonWorkerRequestMessage)
            } catch (error) {
                void this.close(error instanceof Error ? error : new Error(String(error)))
            }
        })
    }

    private handleMessage(message: AddonWorkerResponseMessage): void {
        if (this.closed) return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timeout)
        if (message.ok) pending.resolve(message.result)
        else pending.reject(new AddonWorkerError(message.message, message.invalidArchive))
        if (this.pending.size) return
        this.worker.unref()
        this.idleTimer = setTimeout(() => {
            void this.close()
        }, IDLE_TIMEOUT_MS)
        this.idleTimer.unref()
    }

    private async close(error = new Error('Addon worker session closed'), terminate = true): Promise<void> {
        if (this.closed) return
        this.closed = true
        if (activeSession === this) activeSession = undefined
        clearTimeout(this.idleTimer)
        for (const pending of this.pending.values()) clearTimeout(pending.timeout)
        // Wait for termination before rejecting: the importer may now safely remove its staging directory.
        try {
            if (terminate) await this.worker.terminate()
        } catch {
            // Reject the original operation error even if termination itself fails.
        } finally {
            for (const pending of this.pending.values()) pending.reject(error)
            this.pending.clear()
        }
    }
}

function requestAddonWorker(request: AddonWorkerRequest): Promise<AddonWorkerResult> {
    try {
        activeSession ??= new AddonWorkerSession()
        return activeSession.request(request)
    } catch (error) {
        return Promise.reject(error)
    }
}

export async function validateAddonInWorker(content: string): Promise<AddonValidationOutcome> {
    const result = await requestAddonWorker({ operation: 'validate', content })
    if (result.operation !== 'validate') throw new Error('Unexpected addon worker validation response')
    return result.validation
}

export async function extractAddonArchiveInWorker(archivePath: string, stagingDir: string): Promise<string> {
    const result = await requestAddonWorker({ operation: 'extract', archivePath, stagingDir })
    if (result.operation !== 'extract') throw new Error('Unexpected addon worker extraction response')
    return result.packageHash
}

export async function checkLegacyScriptInWorker(content: string): Promise<boolean> {
    const result = await requestAddonWorker({ operation: 'sanitize', content })
    if (result.operation !== 'sanitize') throw new Error('Unexpected addon worker sanitizer response')
    return result.blocked
}
