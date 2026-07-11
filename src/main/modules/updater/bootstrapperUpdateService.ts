import type { BootstrapUiStateV1 } from '@common/types/bootstrapEvents'
import { bootstrapUiStateFromProgress } from '../bootstrap/updateUiState'
import { runBootstrapperCommand } from '../bootstrapper/command'
import {
    parseDiscardResult,
    parsePrepareResult,
    parseRustUpdateProgress,
    unwrapSemanticResult,
    type DiscardPreparedUpdateResultV1,
    type PrepareUpdateResultV1,
    type RequestedManifestSource,
    type RustUpdateProgressEventV1,
} from '../bootstrapper/contracts'
import type { BootstrapperLauncher } from '../bootstrapper/paths'

export type PrepareDesktopUpdateOptions = {
    activeLeaseId: string
    appExecutable: string
    appExecutableName?: string
    channel: 'beta' | 'alpha' | 'dev'
    dist: string
    githubOwner?: string
    githubRepo?: string
    hostBundle?: string | null
    installedVersion: string
    launcher: BootstrapperLauncher
    manifestUrl?: string
    onDiagnostic?: (line: string) => void
    onProgress?: (event: RustUpdateProgressEventV1, uiState: BootstrapUiStateV1) => void
    requestedSource: RequestedManifestSource
    retainAppVersions: number
    serverHealthUrl?: string
    stateRoot: string
    stagingDir?: string
}

function pushArg(args: string[], name: string, value: string | undefined): void {
    if (value !== undefined && value.length > 0) {
        args.push(name, value)
    }
}

export async function prepareDesktopUpdate(options: PrepareDesktopUpdateOptions): Promise<PrepareUpdateResultV1> {
    const args = [
        '--state-root',
        options.stateRoot,
        '--installed-version',
        options.installedVersion,
        '--dist',
        options.dist,
        '--channel',
        options.channel,
        '--requested-source',
        options.requestedSource,
        '--retain-app-versions',
        String(options.retainAppVersions),
        '--active-lease-id',
        options.activeLeaseId,
    ]
    if (options.hostBundle) {
        pushArg(args, '--host-bundle', options.hostBundle)
        pushArg(args, '--app-executable', options.appExecutable)
    }
    pushArg(args, '--app-executable-name', options.appExecutableName)
    pushArg(args, '--manifest-url', options.manifestUrl)
    pushArg(args, '--server-health-url', options.serverHealthUrl)
    pushArg(args, '--github-owner', options.githubOwner)
    pushArg(args, '--github-repo', options.githubRepo)
    pushArg(args, '--staging-dir', options.stagingDir)

    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'prepare-update',
            args,
            progressJson: true,
            parseProgress: parseRustUpdateProgress,
            onDiagnostic: options.onDiagnostic,
            onProgress: event => options.onProgress?.(event, bootstrapUiStateFromProgress(event)),
            parseResult: parsePrepareResult,
        }),
    )
}

export async function discardPreparedUpdate(options: {
    hostBundle?: string | null
    launcher: BootstrapperLauncher
    reason: 'channel-change' | 'source-change' | 'manual-reset'
    stateRoot: string
    transactionId: string
}): Promise<DiscardPreparedUpdateResultV1> {
    return unwrapSemanticResult(
        await runBootstrapperCommand({
            launcher: options.launcher,
            command: 'discard-prepared-update',
            args: [
                '--state-root',
                options.stateRoot,
                ...(options.hostBundle ? ['--host-bundle', options.hostBundle] : []),
                '--transaction-id',
                options.transactionId,
                '--reason',
                options.reason,
            ],
            parseResult: parseDiscardResult,
        }),
    )
}

export type { PrepareUpdateResultV1, RustUpdateProgressEventV1 } from '../bootstrapper/contracts'
