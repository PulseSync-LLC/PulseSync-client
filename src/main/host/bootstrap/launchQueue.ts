import { randomUUID } from 'node:crypto'

import { captureMainException } from '../../shared/errorTracking'
import logger from '../../shared/logger'

import type { LaunchRequestEnvelopeV1, LaunchRequestInputV1 } from '../../shared/bootstrapper/contracts'

const MAX_ARGUMENTS = 64
const MAX_ARGUMENT_LENGTH = 4_096
const MAX_ADDITIONAL_DATA_KEYS = 32

export type LaunchRequestSink = (request: LaunchRequestInputV1) => Promise<void>

function sanitizeArguments(argv: readonly unknown[]): string[] {
    return argv.slice(0, MAX_ARGUMENTS).map(value => String(value).slice(0, MAX_ARGUMENT_LENGTH))
}

function sanitizeAdditionalData(value: unknown): Record<string, string | number | boolean | null> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const output: Record<string, string | number | boolean | null> = {}
    for (const [key, item] of Object.entries(value).slice(0, MAX_ADDITIONAL_DATA_KEYS)) {
        if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
            output[key.slice(0, 128)] = typeof item === 'string' ? item.slice(0, MAX_ARGUMENT_LENGTH) : item
        }
    }
    return Object.keys(output).length > 0 ? output : undefined
}

export function createLaunchRequestInput(options: {
    additionalData?: unknown
    argv?: readonly unknown[]
    kind?: LaunchRequestInputV1['kind']
    workingDirectory?: string
}): LaunchRequestInputV1 {
    const workingDirectory = options.workingDirectory?.slice(0, MAX_ARGUMENT_LENGTH)
    const additionalData = sanitizeAdditionalData(options.additionalData)
    return {
        schemaVersion: 1,
        kind: options.kind ?? 'arguments',
        argv: sanitizeArguments(options.argv ?? []),
        ...(workingDirectory ? { workingDirectory } : {}),
        ...(additionalData ? { additionalData } : {}),
    }
}

export function createLocalLaunchEnvelope(input: LaunchRequestInputV1, sequence: number): LaunchRequestEnvelopeV1 {
    return {
        ...input,
        id: `local-${randomUUID()}`,
        sequence,
        inboxId: 'local-electron',
        inboxGeneration: 0,
        enqueuedByLeaseId: 'local-electron',
        state: 'claimed',
        claimedByLeaseId: 'local-electron',
        claimedByPid: process.pid,
        claimedByProcessStartId: 'local-electron',
    }
}

export class LaunchQueue {
    private pending: LaunchRequestInputV1[] = []
    private serial: Promise<void> = Promise.resolve()
    private sink: LaunchRequestSink | null = null

    public enqueue(input: LaunchRequestInputV1): void {
        this.pending.push(input)
        if (!this.sink) return
        void this.drain(this.sink).catch(error => {
            logger.main.error('Failed to deliver launch request', error)
            captureMainException(error, 'LaunchQueue/delivery')
        })
    }

    public bindSink(sink: LaunchRequestSink): Promise<void> {
        this.sink = sink
        return this.flush()
    }

    public flush(): Promise<void> {
        return this.sink && this.pending.length > 0 ? this.drain(this.sink) : this.serial
    }

    private drain(sink: LaunchRequestSink): Promise<void> {
        this.serial = this.serial
            .catch(() => {})
            .then(async () => {
                while (this.pending.length > 0) {
                    await sink(this.pending[0])
                    this.pending.shift()
                }
            })
        return this.serial
    }
}
