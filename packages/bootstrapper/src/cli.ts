#!/usr/bin/env node
import { getCurrentDist } from './platform.js'
import { applyBootstrapperTransaction } from './apply.js'
import { createBootstrapperInstallPlan } from './installPlan.js'
import { stageBootstrapperArtifacts, type BootstrapperArtifactKey } from './staging.js'
import { prepareBootstrapperTransaction } from './transaction.js'
import { rollbackBootstrapperTransaction } from './rollback.js'
import { decideBootstrapperUpdate, loadBootstrapperManifest } from './updateCheck.js'

type ParsedArgs = {
    artifacts: BootstrapperArtifactKey[]
    backupDir?: string
    command: string
    dist?: string
    installDir?: string
    installedVersion?: string
    json: boolean
    manifestUrl?: string
    planFile?: string
    stagingDir?: string
    transactionDir?: string
    transactionFile?: string
}

const artifactKeys = new Set<BootstrapperArtifactKey>(['app', 'bootstrapper', 'nativeModules'])

function parseArgs(argv: string[]): ParsedArgs {
    const [command = 'check', ...rest] = argv
    const parsed: ParsedArgs = { artifacts: [], command, json: false }

    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index]
        if (arg === '--json') {
            parsed.json = true
            continue
        }

        if (arg === '--manifest-url') {
            parsed.manifestUrl = rest[++index]
            continue
        }

        if (arg === '--installed-version') {
            parsed.installedVersion = rest[++index]
            continue
        }

        if (arg === '--dist') {
            parsed.dist = rest[++index]
            continue
        }

        if (arg === '--staging-dir') {
            parsed.stagingDir = rest[++index]
            continue
        }

        if (arg === '--install-dir') {
            parsed.installDir = rest[++index]
            continue
        }

        if (arg === '--backup-dir') {
            parsed.backupDir = rest[++index]
            continue
        }

        if (arg === '--plan-file') {
            parsed.planFile = rest[++index]
            continue
        }

        if (arg === '--transaction-dir') {
            parsed.transactionDir = rest[++index]
            continue
        }

        if (arg === '--transaction-file') {
            parsed.transactionFile = rest[++index]
            continue
        }

        if (arg === '--artifact') {
            const artifact = rest[++index] as BootstrapperArtifactKey | undefined
            if (!artifact || !artifactKeys.has(artifact)) {
                throw new Error(`Unsupported artifact: ${artifact ?? ''}`)
            }
            parsed.artifacts.push(artifact)
            continue
        }

        throw new Error(`Unknown argument: ${arg}`)
    }

    return parsed
}

function printUsage(): void {
    console.log('Usage: pulsesync-bootstrapper check --manifest-url <url-or-path> --installed-version <version> [--dist <platform-arch>] [--json]')
    console.log(
        'Usage: pulsesync-bootstrapper download --manifest-url <url-or-path> --installed-version <version> --staging-dir <path> [--dist <platform-arch>] [--artifact app|nativeModules|bootstrapper] [--json]',
    )
    console.log(
        'Usage: pulsesync-bootstrapper plan-install --manifest-url <url-or-path> --installed-version <version> --install-dir <path> --staging-dir <path> [--backup-dir <path>] [--dist <platform-arch>] [--json]',
    )
    console.log('Usage: pulsesync-bootstrapper prepare-install --plan-file <path> [--transaction-dir <path>] [--json]')
    console.log('Usage: pulsesync-bootstrapper apply-install --transaction-file <path> [--json]')
    console.log('Usage: pulsesync-bootstrapper rollback-install --transaction-file <path> [--json]')
}

async function runCheck(args: ParsedArgs): Promise<void> {
    if (!args.manifestUrl) {
        throw new Error('--manifest-url is required')
    }
    if (!args.installedVersion) {
        throw new Error('--installed-version is required')
    }

    const dist = args.dist || getCurrentDist()
    const manifest = await loadBootstrapperManifest(args.manifestUrl)
    const decision = decideBootstrapperUpdate(manifest, args.installedVersion, dist)

    if (args.json) {
        console.log(JSON.stringify(decision, null, 4))
        return
    }

    console.log(`PulseSync bootstrapper check: ${decision.reason}`)
    console.log(`channel=${decision.channel}`)
    console.log(`dist=${decision.dist}`)
    console.log(`current=${decision.currentVersion}`)
    console.log(`target=${decision.targetVersion}`)
    console.log(`updateAvailable=${decision.updateAvailable ? 'yes' : 'no'}`)
    if (decision.artifacts) {
        console.log(`app=${decision.artifacts.app.url}`)
        if (decision.artifacts.nativeModules) {
            console.log(`nativeModules=${decision.artifacts.nativeModules.url}`)
        }
    }
}

async function runDownload(args: ParsedArgs): Promise<void> {
    if (!args.manifestUrl) {
        throw new Error('--manifest-url is required')
    }
    if (!args.installedVersion) {
        throw new Error('--installed-version is required')
    }
    if (!args.stagingDir) {
        throw new Error('--staging-dir is required')
    }

    const dist = args.dist || getCurrentDist()
    const manifest = await loadBootstrapperManifest(args.manifestUrl)
    const decision = decideBootstrapperUpdate(manifest, args.installedVersion, dist)
    const result = await stageBootstrapperArtifacts(decision, args.stagingDir, args.artifacts.length ? args.artifacts : undefined)

    if (args.json) {
        console.log(JSON.stringify(result, null, 4))
        return
    }

    console.log(`PulseSync bootstrapper download: ${result.reason}`)
    console.log(`channel=${result.channel}`)
    console.log(`dist=${result.dist}`)
    console.log(`target=${result.targetVersion}`)
    console.log(`stagingDir=${result.stagingDir}`)
    console.log(`updateAvailable=${result.updateAvailable ? 'yes' : 'no'}`)
    for (const artifact of result.artifacts) {
        console.log(`${artifact.key}=${artifact.path}`)
    }
}

async function runPlanInstall(args: ParsedArgs): Promise<void> {
    if (!args.manifestUrl) {
        throw new Error('--manifest-url is required')
    }
    if (!args.installedVersion) {
        throw new Error('--installed-version is required')
    }
    if (!args.installDir) {
        throw new Error('--install-dir is required')
    }
    if (!args.stagingDir) {
        throw new Error('--staging-dir is required')
    }

    const dist = args.dist || getCurrentDist()
    const manifest = await loadBootstrapperManifest(args.manifestUrl)
    const decision = decideBootstrapperUpdate(manifest, args.installedVersion, dist)
    const plan = await createBootstrapperInstallPlan(decision, {
        artifactKeys: args.artifacts.length ? args.artifacts : undefined,
        backupDir: args.backupDir,
        installDir: args.installDir,
        stagingRootDir: args.stagingDir,
    })

    if (args.json) {
        console.log(JSON.stringify(plan, null, 4))
        return
    }

    console.log(`PulseSync bootstrapper install plan: ${plan.executable ? 'executable' : 'blocked'}`)
    console.log(`channel=${plan.channel}`)
    console.log(`dist=${plan.dist}`)
    console.log(`current=${plan.currentVersion}`)
    console.log(`target=${plan.targetVersion}`)
    console.log(`installDir=${plan.installDir}`)
    console.log(`stagingDir=${plan.stagingDir}`)
    console.log(`backupDir=${plan.backupDir}`)
    for (const artifact of plan.artifacts) {
        console.log(`${artifact.key}=${artifact.action} ${artifact.sourcePath} -> ${artifact.targetPath}`)
    }
    for (const check of plan.preflight) {
        console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}${check.path ? ` (${check.path})` : ''}`)
    }
}

async function runPrepareInstall(args: ParsedArgs): Promise<void> {
    if (!args.planFile) {
        throw new Error('--plan-file is required')
    }

    const result = await prepareBootstrapperTransaction({
        planFile: args.planFile,
        transactionDir: args.transactionDir,
    })

    if (args.json) {
        console.log(JSON.stringify(result, null, 4))
        return
    }

    console.log(`PulseSync bootstrapper prepare install: ${result.state}`)
    console.log(`transactionId=${result.transactionId}`)
    console.log(`channel=${result.channel}`)
    console.log(`dist=${result.dist}`)
    console.log(`target=${result.targetVersion}`)
    console.log(`transactionDir=${result.transactionDir}`)
    console.log(`prepared=${result.prepared ? 'yes' : 'no'}`)
    for (const artifact of result.artifacts) {
        console.log(`${artifact.key}=${artifact.preparedKind} ${artifact.preparedPath}`)
    }
    for (const check of result.checks) {
        console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}${check.path ? ` (${check.path})` : ''}`)
    }
}

async function runApplyInstall(args: ParsedArgs): Promise<void> {
    if (!args.transactionFile) {
        throw new Error('--transaction-file is required')
    }

    const result = await applyBootstrapperTransaction({
        transactionFile: args.transactionFile,
    })

    if (args.json) {
        console.log(JSON.stringify(result, null, 4))
        return
    }

    console.log(`PulseSync bootstrapper apply install: ${result.state}`)
    console.log(`transactionId=${result.transactionId}`)
    console.log(`channel=${result.channel}`)
    console.log(`dist=${result.dist}`)
    console.log(`target=${result.targetVersion}`)
    console.log(`transactionDir=${result.transactionDir}`)
    console.log(`applied=${result.applied ? 'yes' : 'no'}`)
    for (const artifact of result.artifacts) {
        console.log(`${artifact.key}=${artifact.status} ${artifact.preparedPath} -> ${artifact.targetPath}`)
    }
    for (const check of result.checks) {
        console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}${check.path ? ` (${check.path})` : ''}`)
    }
}

async function runRollbackInstall(args: ParsedArgs): Promise<void> {
    if (!args.transactionFile) {
        throw new Error('--transaction-file is required')
    }

    const result = await rollbackBootstrapperTransaction({
        transactionFile: args.transactionFile,
    })

    if (args.json) {
        console.log(JSON.stringify(result, null, 4))
        return
    }

    console.log(`PulseSync bootstrapper rollback install: ${result.state}`)
    console.log(`transactionId=${result.transactionId}`)
    console.log(`channel=${result.channel}`)
    console.log(`dist=${result.dist}`)
    console.log(`target=${result.targetVersion}`)
    console.log(`transactionDir=${result.transactionDir}`)
    console.log(`rolledBack=${result.rolledBack ? 'yes' : 'no'}`)
    for (const artifact of result.artifacts) {
        console.log(`${artifact.key}=${artifact.rollbackStatus} ${artifact.backupPath} -> ${artifact.targetPath}`)
    }
    for (const check of result.checks) {
        console.log(`${check.status.toUpperCase()} ${check.id}: ${check.message}${check.path ? ` (${check.path})` : ''}`)
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    if (args.command === 'check') {
        await runCheck(args)
        return
    }
    if (args.command === 'download') {
        await runDownload(args)
        return
    }
    if (args.command === 'plan-install') {
        await runPlanInstall(args)
        return
    }
    if (args.command === 'prepare-install') {
        await runPrepareInstall(args)
        return
    }
    if (args.command === 'apply-install') {
        await runApplyInstall(args)
        return
    }
    if (args.command === 'rollback-install') {
        await runRollbackInstall(args)
        return
    }

    printUsage()
    throw new Error(`Unknown command: ${args.command}`)
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
