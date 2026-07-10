import { runBootstrapperCommand } from './command'
import {
    parseAckResult,
    parseClaimRequestsResult,
    parseClaimResult,
    parseEnqueueResult,
    parseHandoffArmedProgress,
    parseStartResult,
    unwrapSemanticResult,
    type AckLaunchRequestResultV1,
    type ClaimActiveAppResultV1,
    type ClaimLaunchRequestsResultV1,
    type EnqueueLaunchRequestResultV1,
    type LaunchRequestInputV1,
    type RustHandoffArmedEventV1,
    type StartResultV1,
} from './contracts'
import type { BootstrapperLauncher } from './paths'

function pushArg(args: string[], name: string, value: string | undefined): void {
    if (value !== undefined && value.length > 0) {
        args.push(name, value)
    }
}

export async function claimActiveApp(options: {
    allowUnreservedRecovery?: boolean
    appExecutable: string
    expectedLeaseId?: string
    handoffId?: string
    installRoot: string
    launchReservationId?: string
    launcher: BootstrapperLauncher
    pid?: number
}): Promise<ClaimActiveAppResultV1> {
    const args = ['--install-root', options.installRoot, '--pid', String(options.pid ?? process.pid), '--app-executable', options.appExecutable]
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
    installRoot: string
    launcher: BootstrapperLauncher
}): Promise<EnqueueLaunchRequestResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'enqueue-launch-request',
            args: ['--install-root', options.installRoot, '--active-lease-id', options.activeLeaseId],
            stdin: `${JSON.stringify(options.input)}\n`,
            parseResult: parseEnqueueResult,
        }),
    )
}

export async function claimLaunchRequests(options: {
    activeLeaseId: string
    installRoot: string
    launcher: BootstrapperLauncher
    limit?: number
}): Promise<ClaimLaunchRequestsResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'claim-launch-requests',
            args: ['--install-root', options.installRoot, '--active-lease-id', options.activeLeaseId, '--limit', String(options.limit ?? 64)],
            parseResult: parseClaimRequestsResult,
        }),
    )
}

export async function ackLaunchRequest(options: {
    activeLeaseId: string
    installRoot: string
    launcher: BootstrapperLauncher
    requestId: string
}): Promise<AckLaunchRequestResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'ack-launch-request',
            args: ['--install-root', options.installRoot, '--active-lease-id', options.activeLeaseId, '--request-id', options.requestId],
            parseResult: parseAckResult,
        }),
    )
}

export async function startPreparedHandoff(options: {
    activeLeaseId: string
    appExecutable: string
    appExecutableName: string
    installRoot: string
    launcher: BootstrapperLauncher
    onArmed: (event: RustHandoffArmedEventV1) => void
    onDiagnostic?: (line: string) => void
    passthrough?: string[]
    waitForPid: number
    waitTimeoutMs?: number
}): Promise<StartResultV1> {
    const args = [
        '--install-root',
        options.installRoot,
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

export type {
    ActiveAppLeaseV1,
    LaunchRequestEnvelopeV1,
    LaunchRequestInputV1,
    RustHandoffArmedEventV1,
    StartResultV1,
} from './contracts'
