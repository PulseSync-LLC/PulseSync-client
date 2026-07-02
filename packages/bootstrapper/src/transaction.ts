import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { sanitizePathSegment, sha256File } from './staging.js'
import type { BootstrapperInstallArtifactAction, BootstrapperInstallPlan, BootstrapperInstallPlanArtifact } from './installPlan.js'

export type BootstrapperTransactionState = 'applied' | 'blocked' | 'failed' | 'prepared' | 'rollback-blocked' | 'rolled-back'

export type BootstrapperTransactionCheck = {
    id: string
    message: string
    path?: string
    status: 'block' | 'pass'
}

export type BootstrapperPreparedArtifact = {
    action: BootstrapperInstallArtifactAction
    backupPath: string
    key: 'app' | 'nativeModules'
    preparedKind: 'archive' | 'file'
    preparedPath: string
    sha256: string
    size: number
    sourcePath: string
    targetPath: string
}

export type BootstrapperPrepareTransactionResult = {
    artifacts: BootstrapperPreparedArtifact[]
    backupDir: string
    channel: string
    checks: BootstrapperTransactionCheck[]
    currentVersion: string
    dist: string
    installDir: string
    planFile: string
    prepared: boolean
    schemaVersion: 1
    stagingDir: string
    state: BootstrapperTransactionState
    targetVersion: string
    transactionDir: string
    transactionId: string
}

export type PrepareBootstrapperTransactionOptions = {
    planFile: string
    transactionDir?: string
}

type LoadedPlan =
    | {
          plan: BootstrapperInstallPlan
          planFile: string
      }
    | {
          error: string
          planFile: string
      }

function pass(id: string, message: string, pathValue?: string): BootstrapperTransactionCheck {
    return {
        id,
        message,
        ...(pathValue ? { path: pathValue } : {}),
        status: 'pass',
    }
}

function block(id: string, message: string, pathValue?: string): BootstrapperTransactionCheck {
    return {
        id,
        message,
        ...(pathValue ? { path: pathValue } : {}),
        status: 'block',
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
    const value = record[key]
    return typeof value === 'boolean' ? value : null
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function parseInstallArtifact(value: unknown, index: number): BootstrapperInstallPlanArtifact {
    if (!isRecord(value)) {
        throw new Error(`Plan artifacts[${index}] must be an object`)
    }

    const key = readString(value, 'key')
    if (key !== 'app' && key !== 'nativeModules') {
        throw new Error(`Plan artifacts[${index}].key must be app or nativeModules`)
    }

    const action = readString(value, 'action')
    if (action !== 'replace-file' && action !== 'replace-directory-archive') {
        throw new Error(`Plan artifacts[${index}].action is unsupported`)
    }

    const backupPath = readString(value, 'backupPath')
    const sourcePath = readString(value, 'sourcePath')
    const targetPath = readString(value, 'targetPath')
    const sha256 = readString(value, 'sha256')
    const size = readNumber(value, 'size')
    if (!backupPath || !sourcePath || !targetPath || !sha256 || size === null) {
        throw new Error(`Plan artifacts[${index}] is missing required paths/hash/size`)
    }
    if (!/^[a-f0-9]{64}$/iu.test(sha256)) {
        throw new Error(`Plan artifacts[${index}].sha256 is invalid`)
    }

    return {
        action,
        backupPath,
        key,
        sha256: sha256.toLowerCase(),
        size,
        sourcePath,
        targetPath,
    }
}

function parseInstallPlan(payload: unknown): BootstrapperInstallPlan {
    if (!isRecord(payload)) {
        throw new Error('Plan must be an object')
    }

    const artifactsValue = payload.artifacts
    if (!Array.isArray(artifactsValue)) {
        throw new Error('Plan artifacts must be an array')
    }

    const backupDir = readString(payload, 'backupDir')
    const channel = readString(payload, 'channel')
    const currentVersion = readString(payload, 'currentVersion')
    const dist = readString(payload, 'dist')
    const installDir = readString(payload, 'installDir')
    const stagingDir = readString(payload, 'stagingDir')
    const targetVersion = readString(payload, 'targetVersion')
    const executable = readBoolean(payload, 'executable')
    const updateAvailable = readBoolean(payload, 'updateAvailable')

    if (!backupDir || !channel || !currentVersion || !dist || !installDir || !stagingDir || !targetVersion) {
        throw new Error('Plan is missing required metadata')
    }
    if (executable === null || updateAvailable === null) {
        throw new Error('Plan executable/updateAvailable must be boolean')
    }

    return {
        artifacts: artifactsValue.map(parseInstallArtifact),
        backupDir,
        channel,
        currentVersion,
        dist,
        executable,
        installDir,
        preflight: [],
        stagingDir,
        targetVersion,
        updateAvailable,
    }
}

function isInside(parentDir: string, childPath: string): boolean {
    const relativePath = path.relative(parentDir, childPath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function createTransactionId(): string {
    return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`
}

function resolveStagingRoot(plan: BootstrapperInstallPlan): string {
    return path.resolve(plan.stagingDir, '..', '..', '..')
}

function resolveDefaultTransactionDir(plan: BootstrapperInstallPlan, transactionId: string): string {
    return path.resolve(
        resolveStagingRoot(plan),
        'transactions',
        sanitizePathSegment(plan.channel),
        sanitizePathSegment(plan.targetVersion),
        sanitizePathSegment(plan.dist),
        transactionId,
    )
}

function createBlockedResult(
    planFile: string,
    checks: BootstrapperTransactionCheck[],
    partial?: Partial<BootstrapperPrepareTransactionResult>,
): BootstrapperPrepareTransactionResult {
    return {
        schemaVersion: 1,
        transactionId: partial?.transactionId ?? '',
        state: 'blocked',
        prepared: false,
        channel: partial?.channel ?? '',
        dist: partial?.dist ?? '',
        currentVersion: partial?.currentVersion ?? '',
        targetVersion: partial?.targetVersion ?? '',
        installDir: partial?.installDir ?? '',
        stagingDir: partial?.stagingDir ?? '',
        backupDir: partial?.backupDir ?? '',
        transactionDir: partial?.transactionDir ?? '',
        planFile,
        artifacts: [],
        checks,
    }
}

async function loadInstallPlan(planFile: string): Promise<LoadedPlan> {
    const resolvedPlanFile = path.resolve(planFile)
    try {
        return {
            plan: parseInstallPlan(JSON.parse(await fs.readFile(resolvedPlanFile, 'utf8'))),
            planFile: resolvedPlanFile,
        }
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
            planFile: resolvedPlanFile,
        }
    }
}

async function verifySourceArtifact(artifact: BootstrapperInstallPlanArtifact): Promise<BootstrapperTransactionCheck> {
    try {
        const stat = await fs.stat(artifact.sourcePath)
        if (!stat.isFile()) {
            return block(`source-${artifact.key}`, `${artifact.key} source path is not a file`, artifact.sourcePath)
        }
        if (stat.size !== artifact.size) {
            return block(`source-${artifact.key}`, `${artifact.key} source size mismatch: expected ${artifact.size}, got ${stat.size}`, artifact.sourcePath)
        }

        const sha256 = await sha256File(artifact.sourcePath)
        if (sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
            return block(`source-${artifact.key}`, `${artifact.key} source sha256 mismatch: expected ${artifact.sha256}, got ${sha256}`, artifact.sourcePath)
        }

        return pass(`source-${artifact.key}`, `${artifact.key} source artifact exists and matches plan`, artifact.sourcePath)
    } catch (error) {
        return block(
            `source-${artifact.key}`,
            `${artifact.key} source artifact is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
            artifact.sourcePath,
        )
    }
}

async function copyPreparedArtifact(
    artifact: BootstrapperInstallPlanArtifact,
    preparedDir: string,
): Promise<BootstrapperPreparedArtifact> {
    const preparedKind = artifact.key === 'nativeModules' ? 'archive' : 'file'
    const preparedPath = path.join(preparedDir, artifact.key === 'nativeModules' ? 'nativeModules.zip' : path.basename(artifact.sourcePath))

    await fs.copyFile(artifact.sourcePath, preparedPath)

    return {
        action: artifact.action,
        backupPath: artifact.backupPath,
        key: artifact.key,
        preparedKind,
        preparedPath,
        sha256: artifact.sha256,
        size: artifact.size,
        sourcePath: artifact.sourcePath,
        targetPath: artifact.targetPath,
    }
}

async function writeTransactionState(transactionPath: string, result: BootstrapperPrepareTransactionResult): Promise<void> {
    const tempPath = `${transactionPath}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tempPath, `${JSON.stringify(result, null, 4)}\n`, 'utf8')
    await fs.rename(tempPath, transactionPath)
}

export async function prepareBootstrapperTransaction(options: PrepareBootstrapperTransactionOptions): Promise<BootstrapperPrepareTransactionResult> {
    const loadedPlan = await loadInstallPlan(options.planFile)
    if ('error' in loadedPlan) {
        return createBlockedResult(loadedPlan.planFile, [block('plan-load', `Install plan cannot be loaded: ${loadedPlan.error}`, loadedPlan.planFile)])
    }

    const { plan, planFile } = loadedPlan
    const checks: BootstrapperTransactionCheck[] = []
    const transactionId = createTransactionId()
    const stagingDir = path.resolve(plan.stagingDir)
    const stagingRoot = resolveStagingRoot(plan)
    const backupDir = path.resolve(plan.backupDir)
    const installDir = path.resolve(plan.installDir)
    const transactionDir = path.resolve(options.transactionDir ?? resolveDefaultTransactionDir(plan, transactionId))
    const preparedDir = path.join(transactionDir, 'prepared')
    const transactionPath = path.join(transactionDir, 'transaction.json')

    const partial = {
        backupDir,
        channel: plan.channel,
        currentVersion: plan.currentVersion,
        dist: plan.dist,
        installDir,
        stagingDir,
        targetVersion: plan.targetVersion,
        transactionDir,
        transactionId,
    }

    if (plan.executable) {
        checks.push(pass('plan-executable', 'Install plan is executable'))
    } else {
        checks.push(block('plan-executable', 'Install plan is not executable'))
    }

    if (plan.updateAvailable) {
        checks.push(pass('plan-update-available', 'Install plan targets an available update'))
    } else {
        checks.push(block('plan-update-available', 'Install plan does not target an available update'))
    }

    if (isInside(stagingRoot, transactionDir)) {
        checks.push(pass('transaction-dir-contained', 'Transaction directory stays inside staging root', transactionDir))
    } else {
        checks.push(block('transaction-dir-contained', 'Transaction directory must stay inside staging root', transactionDir))
    }

    if (isInside(stagingRoot, backupDir) && !isInside(installDir, backupDir)) {
        checks.push(pass('backup-dir-contained', 'Backup directory is under staging root and outside install directory', backupDir))
    } else {
        checks.push(block('backup-dir-contained', 'Backup directory must be under staging root and outside install directory', backupDir))
    }

    const artifactByKey = new Map(plan.artifacts.map(artifact => [artifact.key, artifact]))
    for (const key of ['app', 'nativeModules'] as const) {
        if (artifactByKey.has(key)) {
            checks.push(pass(`plan-${key}`, `Install plan includes ${key}`))
        } else {
            checks.push(block(`plan-${key}`, `Install plan is missing ${key}`))
        }
    }

    for (const artifact of plan.artifacts) {
        checks.push(await verifySourceArtifact(artifact))
    }

    if (checks.some(check => check.status === 'block')) {
        return createBlockedResult(planFile, checks, partial)
    }

    await fs.mkdir(preparedDir, { recursive: true })
    await fs.mkdir(backupDir, { recursive: true })

    const artifacts: BootstrapperPreparedArtifact[] = []
    for (const artifact of plan.artifacts) {
        artifacts.push(await copyPreparedArtifact(artifact, preparedDir))
    }

    const result: BootstrapperPrepareTransactionResult = {
        schemaVersion: 1,
        transactionId,
        state: 'prepared',
        prepared: true,
        channel: plan.channel,
        dist: plan.dist,
        currentVersion: plan.currentVersion,
        targetVersion: plan.targetVersion,
        installDir,
        stagingDir,
        backupDir,
        transactionDir,
        planFile,
        artifacts,
        checks,
    }

    await writeTransactionState(transactionPath, result)
    return result
}
