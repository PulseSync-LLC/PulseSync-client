import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BootstrapperLauncher } from '../bootstrapper/paths'
import { runBootstrapperJson } from '../bootstrapper/command'
import type { DesktopUpdateManifestSource } from './desktopManifestSource'

export type BootstrapperArtifact = {
    sha256: string
    signature?: string | null
    signatureAlgorithm?: 'ed25519' | null
    size?: number | null
    url: string
}

export type BootstrapperDistArtifacts = {
    app: BootstrapperArtifact
    bootstrapper?: BootstrapperArtifact | null
    modules: Record<string, BootstrapperArtifact>
}

export type BootstrapperArtifactKey = 'app' | 'bootstrapper' | `module:${string}`

export type BootstrapperUpdateManifest = {
    artifacts: Record<string, BootstrapperDistArtifacts>
    channel: string
    clientVersion: string
    deprecatedVersions?: string[]
    desktopApi?: string
    minClientVersion?: string
    rendererManifestUrl?: string
    schemaVersion: 1
}

export type BootstrapperUpdateDecision = {
    artifacts?: BootstrapperDistArtifacts | null
    channel: string
    currentVersion: string
    dist: string
    reason: 'update-available' | 'up-to-date' | 'missing-dist-artifacts' | 'invalid-version'
    targetVersion: string
    updateAvailable: boolean
}

export type BootstrapperStageProgress = {
    artifactCount: number
    artifactIndex: number
    key: BootstrapperArtifactKey
    loaded: number
    percent: number
    total?: number
}

export type BootstrapperStagingResult = {
    artifacts: Array<{
        key: BootstrapperArtifactKey
        path: string
        reused: boolean
        sha256: string
        size: number
        url: string
    }>
    channel: string
    dist: string
    reason: BootstrapperUpdateDecision['reason']
    stagingDir: string
    targetVersion: string
    updateAvailable: boolean
}

export type BootstrapperInstallPlan = {
    artifacts: Array<{
        action: 'replace-file' | 'replace-directory-archive'
        backupPath: string
        key: BootstrapperArtifactKey
        sha256: string
        size: number
        sourcePath: string
        targetPath: string
    }>
    backupDir: string
    channel: string
    currentVersion: string
    dist: string
    executable: boolean
    installDir: string
    preflight: Array<{
        id: string
        message: string
        path?: string
        status: 'block' | 'pass'
    }>
    stagingDir: string
    targetVersion: string
    updateAvailable: boolean
}

export type BootstrapperPrepareTransactionResult = {
    artifacts: Array<{
        action: 'replace-file' | 'replace-directory-archive'
        backupPath: string
        key: BootstrapperArtifactKey
        preparedKind: 'archive' | 'file'
        preparedPath: string
        sha256: string
        size: number
        sourcePath: string
        targetPath: string
    }>
    backupDir: string
    channel: string
    checks: Array<{
        id: string
        message: string
        path?: string
        status: 'block' | 'pass'
    }>
    currentVersion: string
    dist: string
    installDir: string
    planFile: string
    prepared: boolean
    schemaVersion: 1
    stagingDir: string
    state: 'applied' | 'blocked' | 'failed' | 'prepared' | 'rollback-blocked' | 'rolled-back'
    targetVersion: string
    transactionDir: string
    transactionId: string
}

export type BootstrapperUpdateServiceProgress = BootstrapperStageProgress

export type BootstrapperUpdateServiceResult =
    | {
          decision: BootstrapperUpdateDecision
          manifest: BootstrapperUpdateManifest
          manifestSource: DesktopUpdateManifestSource
          state: 'no-update'
          status: 'idle'
      }
    | {
          decision: BootstrapperUpdateDecision
          installPlan: BootstrapperInstallPlan
          manifest: BootstrapperUpdateManifest
          manifestSource: DesktopUpdateManifestSource
          planFile: string
          prepareResult: BootstrapperPrepareTransactionResult
          stagingResult: BootstrapperStagingResult
          state: 'blocked' | 'prepared'
          status: 'downloaded'
      }

export type CheckAndPrepareDesktopUpdateOptions = {
    installDir: string
    installedVersion: string
    launcher: BootstrapperLauncher
    manifestSource: DesktopUpdateManifestSource
    onDecision?: (decision: BootstrapperUpdateDecision, manifest: BootstrapperUpdateManifest, manifestSource: DesktopUpdateManifestSource) => void
    onProgress?: (progress: BootstrapperUpdateServiceProgress) => void
    stagingRootDir: string
}

const INSTALL_PLAN_FILE_NAME = 'install-plan.json'

function getPlanFilePath(stagingDir: string): string {
    return path.join(stagingDir, INSTALL_PLAN_FILE_NAME)
}

async function writeInstallPlan(planFile: string, plan: BootstrapperInstallPlan): Promise<void> {
    await fs.mkdir(path.dirname(planFile), { recursive: true })
    await fs.writeFile(planFile, `${JSON.stringify(plan, null, 4)}\n`, 'utf8')
}

async function loadManifestText(manifestUrl: string): Promise<string> {
    if (manifestUrl.startsWith('file://')) {
        return await fs.readFile(fileURLToPath(manifestUrl), 'utf8')
    }

    if (/^https?:\/\//iu.test(manifestUrl)) {
        const response = await fetch(manifestUrl, { headers: { Accept: 'application/json' } })
        if (!response.ok) {
            throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`)
        }
        return await response.text()
    }

    return await fs.readFile(manifestUrl, 'utf8')
}

async function loadDesktopUpdateManifest(manifestUrl: string): Promise<BootstrapperUpdateManifest> {
    return JSON.parse(await loadManifestText(manifestUrl)) as BootstrapperUpdateManifest
}

function emitCompleteProgress(options: CheckAndPrepareDesktopUpdateOptions, stagingResult: BootstrapperStagingResult): void {
    if (!options.onProgress || !stagingResult.artifacts.length) {
        return
    }

    options.onProgress({
        artifactCount: stagingResult.artifacts.length,
        artifactIndex: stagingResult.artifacts.length - 1,
        key: stagingResult.artifacts[stagingResult.artifacts.length - 1].key,
        loaded: stagingResult.artifacts.reduce((total, artifact) => total + artifact.size, 0),
        percent: 100,
        total: stagingResult.artifacts.reduce((total, artifact) => total + artifact.size, 0),
    })
}

function isPrepared(result: BootstrapperPrepareTransactionResult): boolean {
    return result.state === 'prepared' && result.prepared
}

export async function checkAndPrepareDesktopUpdate(options: CheckAndPrepareDesktopUpdateOptions): Promise<BootstrapperUpdateServiceResult> {
    const manifestSource = options.manifestSource
    const manifest = await loadDesktopUpdateManifest(manifestSource.url)
    const decision = await runBootstrapperJson<BootstrapperUpdateDecision>({
        launcher: options.launcher,
        command: 'check',
        args: ['--manifest-url', manifestSource.url, '--installed-version', options.installedVersion, '--dist', manifestSource.dist],
    })
    options.onDecision?.(decision, manifest, manifestSource)

    if (!decision.updateAvailable) {
        return {
            state: 'no-update',
            status: 'idle',
            decision,
            manifest,
            manifestSource,
        }
    }

    const stagingRoot = options.stagingRootDir
    const stagingResult = await runBootstrapperJson<BootstrapperStagingResult>({
        launcher: options.launcher,
        command: 'download',
        args: ['--manifest-url', manifestSource.url, '--installed-version', options.installedVersion, '--dist', manifestSource.dist, '--staging-dir', stagingRoot],
    })
    emitCompleteProgress(options, stagingResult)
    const installPlan = await runBootstrapperJson<BootstrapperInstallPlan>({
        launcher: options.launcher,
        command: 'plan-install',
        args: [
            '--manifest-url',
            manifestSource.url,
            '--installed-version',
            options.installedVersion,
            '--dist',
            manifestSource.dist,
            '--install-dir',
            options.installDir,
            '--staging-dir',
            stagingRoot,
        ],
    })
    const planFile = getPlanFilePath(installPlan.stagingDir)
    await writeInstallPlan(planFile, installPlan)

    const prepareResult = await runBootstrapperJson<BootstrapperPrepareTransactionResult>({
        launcher: options.launcher,
        command: 'prepare-install',
        args: ['--plan-file', planFile],
    })

    return {
        state: isPrepared(prepareResult) ? 'prepared' : 'blocked',
        status: 'downloaded',
        decision,
        installPlan,
        manifest,
        manifestSource,
        planFile,
        prepareResult,
        stagingResult,
    }
}

export async function clearPreparedDesktopUpdate(options: { allowedParentDir: string; stagingRootDir: string }): Promise<boolean> {
    const userDataPath = path.resolve(options.allowedParentDir)
    const stagingRoot = options.stagingRootDir
    const resolvedStagingRoot = path.resolve(stagingRoot)
    const relativePath = path.relative(userDataPath, resolvedStagingRoot)

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || path.basename(resolvedStagingRoot) !== 'desktop-updates') {
        throw new Error(`Refusing to clear update root outside userData desktop-updates: ${resolvedStagingRoot}`)
    }

    await fs.rm(resolvedStagingRoot, { force: true, recursive: true })
    await fs.mkdir(resolvedStagingRoot, { recursive: true })
    return true
}
