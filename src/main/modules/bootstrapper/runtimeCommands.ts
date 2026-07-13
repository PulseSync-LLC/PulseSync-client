import { runBootstrapperCommand } from './command'
import {
    parseAckResult,
    parseClaimRequestsResult,
    parseClaimResult,
    parseEnqueueResult,
    parseHandoffArmedProgress,
    parseStartResult,
    parseActiveRuntimeV3,
    parseRuntimeAcknowledgementV3,
    parseRepairRuntimeResultV3,
    unwrapSemanticResult,
    type AckLaunchRequestResultV1,
    type ClaimActiveAppResultV1,
    type ClaimLaunchRequestsResultV1,
    type EnqueueLaunchRequestResultV1,
    type LaunchRequestInputV1,
    type RustHandoffArmedEventV1,
    type StartResultV1,
    type ActiveRuntimeV3,
    type RuntimeAcknowledgementV3,
    type RepairRuntimeResultV3,
} from './contracts'
import type { BootstrapperLauncher } from './paths'

function pushArg(args: string[], name: string, value: string | undefined): void {
    if (value !== undefined && value.length > 0) {
        args.push(name, value)
    }
}

function runtimePathArgs(options: { hostBundle?: string | null; stateRoot: string }): string[] {
    const args = ['--state-root', options.stateRoot]
    pushArg(args, '--host-bundle', options.hostBundle ?? undefined)
    return args
}

export async function claimActiveApp(options: {
    allowUnreservedRecovery?: boolean
    appExecutable: string
    expectedLeaseId?: string
    handoffId?: string
    hostBundle?: string | null
    launchReservationId?: string
    launcher: BootstrapperLauncher
    pid?: number
    stateRoot: string
}): Promise<ClaimActiveAppResultV1> {
    const args = [...runtimePathArgs(options), '--pid', String(options.pid ?? process.pid), '--app-executable', options.appExecutable]
    pushArg(args, '--launch-reservation-id', options.launchReservationId)
    pushArg(args, '--handoff-id', options.handoffId)
    pushArg(args, '--expected-lease-id', options.expectedLeaseId)
    if (options.allowUnreservedRecovery) {
        args.push('--allow-unreserved-recovery')
    }
    return unwrapSemanticResult(
        await runBootstrapperCommand({ launcher: options.launcher, command: 'claim-active-app', args, parseResult: parseClaimResult }),
    )
}

export async function enqueueLaunchRequest(options: {
    activeLeaseId: string
    input: LaunchRequestInputV1
    stateRoot: string
    launcher: BootstrapperLauncher
}): Promise<EnqueueLaunchRequestResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'enqueue-launch-request',
            args: ['--state-root', options.stateRoot, '--active-lease-id', options.activeLeaseId],
            stdin: `${JSON.stringify(options.input)}\n`,
            parseResult: parseEnqueueResult,
        }),
    )
}

export async function claimLaunchRequests(options: {
    activeLeaseId: string
    stateRoot: string
    launcher: BootstrapperLauncher
    limit?: number
}): Promise<ClaimLaunchRequestsResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'claim-launch-requests',
            args: ['--state-root', options.stateRoot, '--active-lease-id', options.activeLeaseId, '--limit', String(options.limit ?? 64)],
            parseResult: parseClaimRequestsResult,
        }),
    )
}

export async function ackLaunchRequest(options: {
    activeLeaseId: string
    stateRoot: string
    launcher: BootstrapperLauncher
    requestId: string
}): Promise<AckLaunchRequestResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'ack-launch-request',
            args: ['--state-root', options.stateRoot, '--active-lease-id', options.activeLeaseId, '--request-id', options.requestId],
            parseResult: parseAckResult,
        }),
    )
}

export async function startPreparedHandoff(options: {
    activeLeaseId: string
    appExecutable: string
    appExecutableName: string
    hostBundle?: string | null
    launcher: BootstrapperLauncher
    onArmed: (event: RustHandoffArmedEventV1) => void
    onDiagnostic?: (line: string) => void
    passthrough?: string[]
    stateRoot: string
    waitForPid: number
    waitTimeoutMs?: number
}): Promise<StartResultV1> {
    const args = [
        ...runtimePathArgs(options),
        '--app-executable-name',
        options.appExecutableName,
        '--app-executable',
        options.appExecutable,
        '--wait-for-pid',
        String(options.waitForPid),
        '--active-lease-id',
        options.activeLeaseId,
        '--wait-timeout-ms',
        String(options.waitTimeoutMs ?? 60_000),
        '--',
        ...(options.passthrough ?? []),
    ]
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'start',
            args,
            progressJson: true,
            parseProgress: parseHandoffArmedProgress,
            onProgress: options.onArmed,
            onDiagnostic: options.onDiagnostic,
            parseResult: parseStartResult,
        }),
    )
}

export async function startCanonicalApp(options: {
    appExecutable: string
    appExecutableName: string
    hostBundle?: string | null
    launcher: BootstrapperLauncher
    passthrough?: string[]
    stateRoot: string
}): Promise<StartResultV1> {
    const args = [
        ...runtimePathArgs(options),
        '--app-executable-name',
        options.appExecutableName,
        '--app-executable',
        options.appExecutable,
        '--',
        ...(options.passthrough ?? []),
    ]
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'start',
            args,
            parseResult: parseStartResult,
        }),
    )
}

export async function resolveActiveRuntime(options: {
    activeLeaseId: string
    hostBundle?: string | null
    launcher: BootstrapperLauncher
    stateRoot: string
}): Promise<ActiveRuntimeV3> {
    const args = ['--state-root', options.stateRoot, '--active-lease-id', options.activeLeaseId]
    if (options.hostBundle) args.push('--host-bundle', options.hostBundle)
    return await runBootstrapperCommand({
        launcher: options.launcher,
        command: 'resolve-runtime',
        args,
        parseResult: parseActiveRuntimeV3,
    })
}

export async function acknowledgeActiveRuntime(options: {
    activeLeaseId: string
    generation: number
    hostBundle?: string | null
    launcher: BootstrapperLauncher
    stateRoot: string
}): Promise<RuntimeAcknowledgementV3> {
    const args = ['--state-root', options.stateRoot, '--active-lease-id', options.activeLeaseId, '--generation', String(options.generation)]
    if (options.hostBundle) args.push('--host-bundle', options.hostBundle)
    return await runBootstrapperCommand({
        launcher: options.launcher,
        command: 'acknowledge-runtime',
        args,
        parseResult: parseRuntimeAcknowledgementV3,
    })
}

export async function repairActiveRuntime(options: {
    channel: string
    dist: string
    launcher: BootstrapperLauncher
    manifestUrl?: string
    requestedSource: 'backend' | 'github' | 'direct'
    serverHealthUrl?: string
    stateRoot: string
}): Promise<RepairRuntimeResultV3> {
    const args = [
        '--state-root',
        options.stateRoot,
        '--channel',
        options.channel,
        '--dist',
        options.dist,
        '--requested-source',
        options.requestedSource,
    ]
    pushArg(args, '--manifest-url', options.manifestUrl)
    pushArg(args, '--server-health-url', options.serverHealthUrl)
    return await runBootstrapperCommand({
        launcher: options.launcher,
        command: 'repair',
        args,
        parseResult: parseRepairRuntimeResultV3,
    })
}

export type { ActiveAppLeaseV1, LaunchRequestEnvelopeV1, LaunchRequestInputV1, RustHandoffArmedEventV1, StartResultV1 } from './contracts'
