import * as path from 'node:path'
import { Worker } from 'node:worker_threads'
import isAppDev from '../../../utils/isAppDev'
import type {
    ArtifactWorkerRequest,
    ArtifactWorkerRequestMessage,
    ArtifactWorkerResponse,
    ArtifactWorkerResponseMessage,
    ArtifactWorkerStage,
    HashArtifactRequest,
    InstallUnpackedArtifactRequest,
    PrepareAsarArtifactRequest,
} from './artifactWorker.types'

const ARTIFACT_WORKER_TIMEOUT_MS = 5 * 60 * 1000
const ARTIFACT_WORKER_IDLE_TIMEOUT_MS = 15 * 1000

type PendingRequest = {
    resolve: (result: ArtifactWorkerResult) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
}

type ArtifactWorkerResult = {
    response: ArtifactWorkerResponse
    workerThreadId: number
}

let activeSession: ArtifactWorkerSession | null = null
let nextRequestId = 1

export class ArtifactWorkerError extends Error {
    constructor(
        message: string,
        public readonly stage: ArtifactWorkerStage,
        public readonly code?: string,
    ) {
        super(message)
    }
}

function resolveArtifactWorkerPath(): string {
    return isAppDev
        ? path.resolve(__dirname, '..', 'worker', 'artifactWorker.cjs')
        : path.join(process.resourcesPath, 'app.asar.unpacked', '.vite', 'worker', 'artifactWorker.cjs')
}

class ArtifactWorkerSession {
    private readonly worker = new Worker(resolveArtifactWorkerPath())
    private readonly pending = new Map<number, PendingRequest>()
    private idleTimer: NodeJS.Timeout | null = null
    private closed = false

    constructor() {
        this.worker.on('message', (message: ArtifactWorkerResponseMessage) => this.handleMessage(message))
        this.worker.once('error', error => this.close(error instanceof Error ? error : new Error(String(error))))
        this.worker.once('exit', code => {
            if (!this.closed) this.close(new Error(`Artifact worker exited before returning all results (code ${code})`), false)
        })
        this.worker.unref()
    }

    request(request: ArtifactWorkerRequest): Promise<ArtifactWorkerResult> {
        if (this.closed) return Promise.reject(new Error('Artifact worker session is closed'))

        this.clearIdleTimer()
        this.worker.ref()
        const id = nextRequestId++

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.close(new Error(`Artifact worker timed out after ${ARTIFACT_WORKER_TIMEOUT_MS / 1000} seconds`))
            }, ARTIFACT_WORKER_TIMEOUT_MS)
            const pendingRequest: PendingRequest = { resolve, reject, timeout }
            this.pending.set(id, pendingRequest)

            const message: ArtifactWorkerRequestMessage = { id, request }
            try {
                this.worker.postMessage(message)
            } catch (error) {
                this.close(error instanceof Error ? error : new Error(String(error)))
            }
        })
    }

    private handleMessage(message: ArtifactWorkerResponseMessage): void {
        const pendingRequest = this.pending.get(message.id)
        if (!pendingRequest) return

        this.pending.delete(message.id)
        clearTimeout(pendingRequest.timeout)
        if (message.response.ok) {
            pendingRequest.resolve({ response: message.response, workerThreadId: message.workerThreadId })
        } else {
            pendingRequest.reject(new ArtifactWorkerError(message.response.message, message.response.stage, message.response.code))
        }
        this.scheduleIdleTermination()
    }

    private scheduleIdleTermination(): void {
        if (this.closed || this.pending.size > 0) return
        this.worker.unref()
        this.idleTimer = setTimeout(() => this.close(undefined), ARTIFACT_WORKER_IDLE_TIMEOUT_MS)
        this.idleTimer.unref()
    }

    private clearIdleTimer(): void {
        if (!this.idleTimer) return
        clearTimeout(this.idleTimer)
        this.idleTimer = null
    }

    private close(error?: Error, terminate = true): void {
        if (this.closed) return
        this.closed = true
        this.clearIdleTimer()
        if (activeSession === this) activeSession = null

        const closeError = error ?? new Error('Artifact worker session closed')
        for (const pendingRequest of this.pending.values()) {
            clearTimeout(pendingRequest.timeout)
            pendingRequest.reject(closeError)
        }
        this.pending.clear()
        if (terminate) void this.worker.terminate()
    }
}

function getArtifactWorkerSession(): ArtifactWorkerSession {
    if (!activeSession) activeSession = new ArtifactWorkerSession()
    return activeSession
}

async function runArtifactWorker(request: ArtifactWorkerRequest): Promise<ArtifactWorkerResult> {
    return await getArtifactWorkerSession().request(request)
}

const formatWarnings = (response: Extract<ArtifactWorkerResponse, { ok: true }>): string[] =>
    response.warnings.map(warning => `${warning.code ? `${warning.code}: ` : ''}${warning.message}`)

export async function installUnpackedArtifactInWorker(
    request: Omit<InstallUnpackedArtifactRequest, 'mode'>,
): Promise<{ durations: Record<string, number>; warnings: string[]; workerThreadId: number }> {
    const { response, workerThreadId } = await runArtifactWorker({ ...request, mode: 'installUnpacked' })
    if (!response.ok || response.mode !== 'installUnpacked') throw new Error('Artifact worker returned an unexpected response')
    return { durations: response.durations, warnings: formatWarnings(response), workerThreadId }
}

export async function prepareAsarArtifactInWorker(
    request: Omit<PrepareAsarArtifactRequest, 'mode'>,
): Promise<{ durations: Record<string, number>; preparedPath: string; warnings: string[]; workerThreadId: number }> {
    const { response, workerThreadId } = await runArtifactWorker({ ...request, mode: 'prepareAsar' })
    if (!response.ok || response.mode !== 'prepareAsar') throw new Error('Artifact worker returned an unexpected response')
    return { durations: response.durations, preparedPath: response.preparedPath, warnings: formatWarnings(response), workerThreadId }
}

export async function hashArtifactInWorker(
    request: Omit<HashArtifactRequest, 'mode'>,
): Promise<{ checksum: string; durationMs: number; workerThreadId: number }> {
    const { response, workerThreadId } = await runArtifactWorker({ ...request, mode: 'hashFile' })
    if (!response.ok || response.mode !== 'hashFile') throw new Error('Artifact worker returned an unexpected response')
    return { checksum: response.checksum, durationMs: response.durations.checksum ?? 0, workerThreadId }
}
