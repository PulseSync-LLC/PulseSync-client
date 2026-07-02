import fs from 'node:fs/promises'
import path from 'node:path'
import type { BootstrapperAppliedArtifact, BootstrapperApplyTransactionResult } from './apply.js'
import type { BootstrapperTransactionCheck, BootstrapperTransactionState } from './transaction.js'

type RollbackSourceState = Extract<BootstrapperTransactionState, 'applied' | 'failed' | 'rollback-blocked' | 'rolled-back'>
type RollbackArtifactStatus = 'blocked' | 'noop' | 'removed-created-target' | 'restored'

export type BootstrapperRollbackArtifact = BootstrapperAppliedArtifact & {
    rollbackMessage: string
    rollbackStatus: RollbackArtifactStatus
    rolledBackAt?: string
}

export type BootstrapperRollbackTransactionResult = Omit<BootstrapperApplyTransactionResult, 'artifacts' | 'state'> & {
    artifacts: BootstrapperRollbackArtifact[]
    idempotent?: boolean
    rollbackBlockedAt?: string
    rollbackError?: string
    rollbackStartedAt: string
    rolledBack: boolean
    rolledBackAt?: string
    state: Extract<BootstrapperTransactionState, 'rollback-blocked' | 'rolled-back'>
}

export type RollbackBootstrapperTransactionOptions = {
    transactionFile: string
}

type ParsedRollbackTransaction = Omit<BootstrapperApplyTransactionResult, 'artifacts' | 'state'> & {
    artifacts: BootstrapperAppliedArtifact[]
    state: RollbackSourceState
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

function isInside(parentDir: string, childPath: string): boolean {
    const relativePath = path.relative(parentDir, childPath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
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

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.stat(targetPath)
        return true
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (code === 'ENOENT') {
            return false
        }
        throw error
    }
}

function parseAppliedArtifact(value: unknown, index: number): BootstrapperAppliedArtifact {
    if (!isRecord(value)) {
        throw new Error(`Transaction artifacts[${index}] must be an object`)
    }

    const action = readString(value, 'action')
    if (action !== 'replace-file' && action !== 'replace-directory-archive') {
        throw new Error(`Transaction artifacts[${index}].action is unsupported`)
    }

    const key = readString(value, 'key')
    if (key !== 'app' && key !== 'nativeModules') {
        throw new Error(`Transaction artifacts[${index}].key must be app or nativeModules`)
    }

    const preparedKind = readString(value, 'preparedKind')
    if (preparedKind !== 'archive' && preparedKind !== 'file') {
        throw new Error(`Transaction artifacts[${index}].preparedKind is unsupported`)
    }

    const status = readString(value, 'status')
    if (status !== 'applied' && status !== 'failed') {
        throw new Error(`Transaction artifacts[${index}].status must be applied or failed`)
    }

    const backupStatus = readString(value, 'backupStatus')
    if (backupStatus !== null && backupStatus !== 'created' && backupStatus !== 'missing') {
        throw new Error(`Transaction artifacts[${index}].backupStatus is unsupported`)
    }

    const backupPath = readString(value, 'backupPath')
    const message = readString(value, 'message')
    const preparedPath = readString(value, 'preparedPath')
    const sha256 = readString(value, 'sha256')
    const size = readNumber(value, 'size')
    const sourcePath = readString(value, 'sourcePath')
    const targetPath = readString(value, 'targetPath')
    if (!backupPath || !message || !preparedPath || !sha256 || size === null || !sourcePath || !targetPath) {
        throw new Error(`Transaction artifacts[${index}] is missing required rollback fields`)
    }

    return {
        action,
        backupPath: path.resolve(backupPath),
        key,
        preparedKind,
        preparedPath: path.resolve(preparedPath),
        sha256,
        size,
        sourcePath: path.resolve(sourcePath),
        targetPath: path.resolve(targetPath),
        appliedAt: readString(value, 'appliedAt') ?? undefined,
        backupStatus: backupStatus ?? undefined,
        error: readString(value, 'error') ?? undefined,
        message,
        requiresExternalInstaller: readBoolean(value, 'requiresExternalInstaller') ?? undefined,
        status,
    }
}

function parseRollbackTransaction(payload: unknown): ParsedRollbackTransaction {
    if (!isRecord(payload)) {
        throw new Error('Transaction must be an object')
    }

    const artifactsValue = payload.artifacts
    if (!Array.isArray(artifactsValue)) {
        throw new Error('Transaction artifacts must be an array')
    }

    const schemaVersion = readNumber(payload, 'schemaVersion')
    const state = readString(payload, 'state')
    if (schemaVersion !== 1) {
        throw new Error('Transaction schemaVersion must be 1')
    }
    if (state !== 'applied' && state !== 'failed' && state !== 'rolled-back' && state !== 'rollback-blocked') {
        throw new Error(`Transaction state is not rollback-compatible: ${state ?? 'missing'}`)
    }

    const transactionId = readString(payload, 'transactionId')
    const channel = readString(payload, 'channel')
    const currentVersion = readString(payload, 'currentVersion')
    const dist = readString(payload, 'dist')
    const installDir = readString(payload, 'installDir')
    const stagingDir = readString(payload, 'stagingDir')
    const backupDir = readString(payload, 'backupDir')
    const targetVersion = readString(payload, 'targetVersion')
    const transactionDir = readString(payload, 'transactionDir')
    const planFile = readString(payload, 'planFile')
    const applyStartedAt = readString(payload, 'applyStartedAt')
    if (
        !transactionId ||
        !channel ||
        !currentVersion ||
        !dist ||
        !installDir ||
        !stagingDir ||
        !backupDir ||
        !targetVersion ||
        !transactionDir ||
        !planFile ||
        !applyStartedAt
    ) {
        throw new Error('Transaction is missing required rollback metadata')
    }

    return {
        schemaVersion: 1,
        transactionId,
        state,
        prepared: true,
        applied: readBoolean(payload, 'applied') ?? false,
        applyStartedAt,
        appliedAt: readString(payload, 'appliedAt') ?? undefined,
        error: readString(payload, 'error') ?? undefined,
        failedAt: readString(payload, 'failedAt') ?? undefined,
        channel,
        dist,
        currentVersion,
        targetVersion,
        installDir: path.resolve(installDir),
        stagingDir: path.resolve(stagingDir),
        backupDir: path.resolve(backupDir),
        transactionDir: path.resolve(transactionDir),
        planFile: path.resolve(planFile),
        artifacts: artifactsValue.map(parseAppliedArtifact),
        checks: [],
    }
}

function validateArtifactPaths(transaction: ParsedRollbackTransaction, artifact: BootstrapperAppliedArtifact): BootstrapperTransactionCheck[] {
    const checks: BootstrapperTransactionCheck[] = []

    if (isInside(transaction.installDir, artifact.targetPath)) {
        checks.push(pass(`target-${artifact.key}-path`, `${artifact.key} target path stays inside install directory`, artifact.targetPath))
    } else {
        checks.push(block(`target-${artifact.key}-path`, `${artifact.key} target path escapes install directory`, artifact.targetPath))
    }

    if (isInside(transaction.backupDir, artifact.backupPath) && !isInside(transaction.installDir, artifact.backupPath)) {
        checks.push(pass(`backup-${artifact.key}-path`, `${artifact.key} backup path stays inside backup directory`, artifact.backupPath))
    } else {
        checks.push(block(`backup-${artifact.key}-path`, `${artifact.key} backup path must stay inside backup directory and outside install directory`, artifact.backupPath))
    }

    return checks
}

async function restoreBackup(artifact: BootstrapperAppliedArtifact): Promise<RollbackArtifactStatus> {
    if (!(await pathExists(artifact.backupPath))) {
        throw new Error(`backup path is missing: ${artifact.backupPath}`)
    }

    await fs.rm(artifact.targetPath, { force: true, recursive: true })
    await fs.mkdir(path.dirname(artifact.targetPath), { recursive: true })
    await fs.rename(artifact.backupPath, artifact.targetPath)
    return 'restored'
}

async function removeCreatedTarget(artifact: BootstrapperAppliedArtifact): Promise<RollbackArtifactStatus> {
    await fs.rm(artifact.targetPath, { force: true, recursive: true })
    return 'removed-created-target'
}

async function rollbackArtifact(artifact: BootstrapperAppliedArtifact): Promise<BootstrapperRollbackArtifact> {
    if (artifact.backupStatus === 'created') {
        const rollbackStatus = await restoreBackup(artifact)
        return {
            ...artifact,
            rollbackMessage: 'Restored transaction-recorded backup to target path',
            rollbackStatus,
            rolledBackAt: new Date().toISOString(),
        }
    }

    if (artifact.status === 'applied' && artifact.backupStatus === 'missing') {
        const rollbackStatus = await removeCreatedTarget(artifact)
        return {
            ...artifact,
            rollbackMessage: 'Removed target that was created during apply',
            rollbackStatus,
            rolledBackAt: new Date().toISOString(),
        }
    }

    return {
        ...artifact,
        rollbackMessage: 'No rollback write required for this artifact',
        rollbackStatus: 'noop',
        rolledBackAt: new Date().toISOString(),
    }
}

function createRollbackBlockedResult(
    transaction: ParsedRollbackTransaction,
    checks: BootstrapperTransactionCheck[],
    startedAt: string,
    artifacts: BootstrapperRollbackArtifact[],
    error: unknown,
): BootstrapperRollbackTransactionResult {
    return {
        ...transaction,
        state: 'rollback-blocked',
        rolledBack: false,
        rollbackStartedAt: startedAt,
        rollbackBlockedAt: new Date().toISOString(),
        rollbackError: error instanceof Error ? error.message : String(error),
        checks,
        artifacts,
    }
}

async function writeTransactionState(transactionFile: string, result: BootstrapperRollbackTransactionResult): Promise<void> {
    const tempPath = `${transactionFile}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tempPath, `${JSON.stringify(result, null, 4)}\n`, 'utf8')
    await fs.rename(tempPath, transactionFile)
}

function createIdempotentResult(transaction: ParsedRollbackTransaction, startedAt: string): BootstrapperRollbackTransactionResult {
    return {
        ...transaction,
        state: 'rolled-back',
        rolledBack: true,
        idempotent: true,
        rollbackStartedAt: startedAt,
        rolledBackAt: new Date().toISOString(),
        artifacts: transaction.artifacts.map(artifact => ({
            ...artifact,
            rollbackMessage: 'Transaction is already rolled back',
            rollbackStatus: 'noop',
            rolledBackAt: new Date().toISOString(),
        })),
        checks: [pass('transaction-state', 'Transaction is already rolled back')],
    }
}

export async function rollbackBootstrapperTransaction(options: RollbackBootstrapperTransactionOptions): Promise<BootstrapperRollbackTransactionResult> {
    const transactionFile = path.resolve(options.transactionFile)
    const startedAt = new Date().toISOString()
    const transaction = parseRollbackTransaction(JSON.parse(await fs.readFile(transactionFile, 'utf8')))

    if (transaction.state === 'rolled-back') {
        return createIdempotentResult(transaction, startedAt)
    }

    const checks = [
        transaction.state === 'applied' || transaction.state === 'failed'
            ? pass('transaction-state', `Transaction is rollback-compatible: ${transaction.state}`)
            : block('transaction-state', `Transaction cannot be rolled back from state: ${transaction.state}`),
        ...(isInside(transaction.transactionDir, transactionFile)
            ? [pass('transaction-file-contained', 'Transaction file stays inside transaction directory', transactionFile)]
            : [block('transaction-file-contained', 'Transaction file must stay inside transaction directory', transactionFile)]),
        ...transaction.artifacts.flatMap(artifact => validateArtifactPaths(transaction, artifact)),
    ]

    if (checks.some(check => check.status === 'block')) {
        const result = createRollbackBlockedResult(transaction, checks, startedAt, [], 'Rollback path validation failed')
        await writeTransactionState(transactionFile, result)
        return result
    }

    const rolledBackArtifacts: BootstrapperRollbackArtifact[] = []
    try {
        for (const artifact of transaction.artifacts) {
            rolledBackArtifacts.push(await rollbackArtifact(artifact))
        }

        const result: BootstrapperRollbackTransactionResult = {
            ...transaction,
            state: 'rolled-back',
            rolledBack: true,
            rollbackStartedAt: startedAt,
            rolledBackAt: new Date().toISOString(),
            checks,
            artifacts: rolledBackArtifacts,
        }
        await writeTransactionState(transactionFile, result)
        return result
    } catch (error) {
        const failedArtifact = transaction.artifacts[rolledBackArtifacts.length]
        const artifacts: BootstrapperRollbackArtifact[] = failedArtifact
            ? [
                  ...rolledBackArtifacts,
                  {
                      ...failedArtifact,
                      rollbackMessage: error instanceof Error ? error.message : String(error),
                      rollbackStatus: 'blocked',
                      rolledBackAt: new Date().toISOString(),
                  },
              ]
            : rolledBackArtifacts
        const result = createRollbackBlockedResult(transaction, checks, startedAt, artifacts, error)
        await writeTransactionState(transactionFile, result)
        return result
    }
}
