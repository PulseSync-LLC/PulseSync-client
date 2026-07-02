import fs from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { sha256File } from './staging.js'
import type {
    BootstrapperPreparedArtifact,
    BootstrapperPrepareTransactionResult,
    BootstrapperTransactionCheck,
    BootstrapperTransactionState,
} from './transaction.js'

type ApplyArtifactStatus = 'applied' | 'failed'
type ApplyBackupStatus = 'created' | 'missing'

export type BootstrapperAppliedArtifact = BootstrapperPreparedArtifact & {
    appliedAt?: string
    backupStatus?: ApplyBackupStatus
    error?: string
    message: string
    requiresExternalInstaller?: boolean
    status: ApplyArtifactStatus
}

export type BootstrapperApplyTransactionResult = Omit<BootstrapperPrepareTransactionResult, 'state'> & {
    applied: boolean
    appliedAt?: string
    applyStartedAt: string
    artifacts: BootstrapperAppliedArtifact[]
    error?: string
    failedAt?: string
    state: Extract<BootstrapperTransactionState, 'applied' | 'failed'>
}

export type ApplyBootstrapperTransactionOptions = {
    transactionFile: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
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

class ArtifactApplyError extends Error {
    backupStatus?: ApplyBackupStatus

    constructor(error: unknown, backupStatus?: ApplyBackupStatus) {
        super(error instanceof Error ? error.message : String(error))
        this.name = 'ArtifactApplyError'
        this.backupStatus = backupStatus
    }
}

function parsePreparedArtifact(value: unknown, index: number): BootstrapperPreparedArtifact {
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

    const backupPath = readString(value, 'backupPath')
    const preparedPath = readString(value, 'preparedPath')
    const sha256 = readString(value, 'sha256')
    const size = readNumber(value, 'size')
    const sourcePath = readString(value, 'sourcePath')
    const targetPath = readString(value, 'targetPath')

    if (!backupPath || !preparedPath || !sha256 || size === null || !sourcePath || !targetPath) {
        throw new Error(`Transaction artifacts[${index}] is missing required paths/hash/size`)
    }
    if (!/^[a-f0-9]{64}$/iu.test(sha256)) {
        throw new Error(`Transaction artifacts[${index}].sha256 is invalid`)
    }

    return {
        action,
        backupPath: path.resolve(backupPath),
        key,
        preparedKind,
        preparedPath: path.resolve(preparedPath),
        sha256: sha256.toLowerCase(),
        size,
        sourcePath: path.resolve(sourcePath),
        targetPath: path.resolve(targetPath),
    }
}

function parsePreparedTransaction(payload: unknown): BootstrapperPrepareTransactionResult {
    if (!isRecord(payload)) {
        throw new Error('Transaction must be an object')
    }

    const artifactsValue = payload.artifacts
    if (!Array.isArray(artifactsValue)) {
        throw new Error('Transaction artifacts must be an array')
    }

    const schemaVersion = readNumber(payload, 'schemaVersion')
    const transactionId = readString(payload, 'transactionId')
    const state = readString(payload, 'state')
    const channel = readString(payload, 'channel')
    const currentVersion = readString(payload, 'currentVersion')
    const dist = readString(payload, 'dist')
    const installDir = readString(payload, 'installDir')
    const stagingDir = readString(payload, 'stagingDir')
    const backupDir = readString(payload, 'backupDir')
    const targetVersion = readString(payload, 'targetVersion')
    const transactionDir = readString(payload, 'transactionDir')
    const planFile = readString(payload, 'planFile')

    if (schemaVersion !== 1) {
        throw new Error('Transaction schemaVersion must be 1')
    }
    if (state !== 'prepared') {
        throw new Error(`Transaction state must be prepared, got ${state ?? 'missing'}`)
    }
    if (!transactionId || !channel || !currentVersion || !dist || !installDir || !stagingDir || !backupDir || !targetVersion || !transactionDir || !planFile) {
        throw new Error('Transaction is missing required metadata')
    }

    return {
        schemaVersion: 1,
        transactionId,
        state: 'prepared',
        prepared: true,
        channel,
        dist,
        currentVersion,
        targetVersion,
        installDir: path.resolve(installDir),
        stagingDir: path.resolve(stagingDir),
        backupDir: path.resolve(backupDir),
        transactionDir: path.resolve(transactionDir),
        planFile: path.resolve(planFile),
        artifacts: artifactsValue.map(parsePreparedArtifact),
        checks: [],
    }
}

async function writeTransactionState(transactionFile: string, result: BootstrapperApplyTransactionResult): Promise<void> {
    const tempPath = `${transactionFile}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tempPath, `${JSON.stringify(result, null, 4)}\n`, 'utf8')
    await fs.rename(tempPath, transactionFile)
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

async function verifyPreparedArtifact(artifact: BootstrapperPreparedArtifact): Promise<void> {
    const stat = await fs.stat(artifact.preparedPath)
    if (!stat.isFile()) {
        throw new Error('prepared artifact path is not a file')
    }
    if (stat.size !== artifact.size) {
        throw new Error(`prepared artifact size mismatch: expected ${artifact.size}, got ${stat.size}`)
    }

    const sha256 = await sha256File(artifact.preparedPath)
    if (sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
        throw new Error(`prepared artifact sha256 mismatch: expected ${artifact.sha256}, got ${sha256}`)
    }
}

async function backupTarget(artifact: BootstrapperPreparedArtifact): Promise<ApplyBackupStatus> {
    if (!(await pathExists(artifact.targetPath))) {
        return 'missing'
    }
    if (await pathExists(artifact.backupPath)) {
        throw new Error(`backup path already exists: ${artifact.backupPath}`)
    }

    await fs.mkdir(path.dirname(artifact.backupPath), { recursive: true })
    await fs.rename(artifact.targetPath, artifact.backupPath)
    return 'created'
}

async function applyFileArtifact(artifact: BootstrapperPreparedArtifact): Promise<ApplyBackupStatus> {
    let backupStatus: ApplyBackupStatus | undefined
    try {
        backupStatus = await backupTarget(artifact)
        await fs.mkdir(path.dirname(artifact.targetPath), { recursive: true })
        await fs.copyFile(artifact.preparedPath, artifact.targetPath)
        return backupStatus
    } catch (error) {
        throw new ArtifactApplyError(error, backupStatus)
    }
}

function assertSafeZipEntries(zip: AdmZip, artifact: BootstrapperPreparedArtifact): void {
    for (const entry of zip.getEntries()) {
        const entryName = entry.entryName.replace(/\\/gu, '/')
        if (!entryName || entryName.startsWith('/') || entryName.includes('../') || entryName === '..' || entryName.startsWith('..')) {
            throw new Error(`archive contains unsafe entry path: ${entry.entryName}`)
        }
        if (path.isAbsolute(entryName)) {
            throw new Error(`archive contains absolute entry path: ${entry.entryName}`)
        }
    }

    if (artifact.preparedKind !== 'archive') {
        throw new Error('directory archive artifact must have preparedKind=archive')
    }
}

async function resolveExtractedDirectory(extractedDir: string, targetPath: string): Promise<string> {
    const entries = await fs.readdir(extractedDir, { withFileTypes: true })
    const targetName = path.basename(targetPath)
    const matchingEntry = entries.find(entry => entry.isDirectory() && entry.name === targetName)
    if (matchingEntry) {
        return path.join(extractedDir, matchingEntry.name)
    }

    return extractedDir
}

async function applyDirectoryArchiveArtifact(artifact: BootstrapperPreparedArtifact, transactionDir: string): Promise<ApplyBackupStatus> {
    const tempDir = path.join(transactionDir, 'apply-temp', `${artifact.key}-${process.pid}-${Date.now()}`)
    let backupStatus: ApplyBackupStatus | undefined
    if (!isInside(transactionDir, tempDir)) {
        throw new Error(`temporary extraction path escapes transaction directory: ${tempDir}`)
    }

    const zip = new AdmZip(artifact.preparedPath)
    assertSafeZipEntries(zip, artifact)

    await fs.rm(tempDir, { force: true, recursive: true })
    await fs.mkdir(tempDir, { recursive: true })
    try {
        zip.extractAllTo(tempDir, true)
        const extractedPath = await resolveExtractedDirectory(tempDir, artifact.targetPath)
        backupStatus = await backupTarget(artifact)
        await fs.mkdir(path.dirname(artifact.targetPath), { recursive: true })
        await fs.rename(extractedPath, artifact.targetPath)
        return backupStatus
    } catch (error) {
        await fs.rm(tempDir, { force: true, recursive: true })
        throw new ArtifactApplyError(error, backupStatus)
    } finally {
        await fs.rm(path.dirname(tempDir), { force: true, recursive: true })
    }
}

function validateArtifactPaths(transaction: BootstrapperPrepareTransactionResult, artifact: BootstrapperPreparedArtifact): BootstrapperTransactionCheck[] {
    const checks: BootstrapperTransactionCheck[] = []

    if (isInside(transaction.transactionDir, artifact.preparedPath)) {
        checks.push(pass(`prepared-${artifact.key}-path`, `${artifact.key} prepared path stays inside transaction directory`, artifact.preparedPath))
    } else {
        checks.push(block(`prepared-${artifact.key}-path`, `${artifact.key} prepared path escapes transaction directory`, artifact.preparedPath))
    }

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

async function applyArtifact(artifact: BootstrapperPreparedArtifact, transaction: BootstrapperPrepareTransactionResult): Promise<BootstrapperAppliedArtifact> {
    await verifyPreparedArtifact(artifact)

    if (artifact.action === 'replace-file') {
        const backupStatus = await applyFileArtifact(artifact)
        return {
            ...artifact,
            appliedAt: new Date().toISOString(),
            backupStatus,
            message:
                artifact.key === 'app'
                    ? 'App artifact copied to transaction-recorded update path; external installer execution is deferred'
                    : 'File artifact applied',
            requiresExternalInstaller: artifact.key === 'app' ? true : undefined,
            status: 'applied',
        }
    }

    if (artifact.action === 'replace-directory-archive') {
        const backupStatus = await applyDirectoryArchiveArtifact(artifact, transaction.transactionDir)
        return {
            ...artifact,
            appliedAt: new Date().toISOString(),
            backupStatus,
            message: 'Directory archive extracted and moved to transaction-recorded target path',
            status: 'applied',
        }
    }

    throw new Error(`Unsupported artifact action: ${artifact.action}`)
}

function createFailureResult(
    transaction: BootstrapperPrepareTransactionResult,
    checks: BootstrapperTransactionCheck[],
    startedAt: string,
    artifacts: BootstrapperAppliedArtifact[],
    error: unknown,
): BootstrapperApplyTransactionResult {
    return {
        ...transaction,
        state: 'failed',
        applied: false,
        applyStartedAt: startedAt,
        failedAt: new Date().toISOString(),
        checks,
        artifacts,
        prepared: true,
        planFile: transaction.planFile,
        transactionDir: transaction.transactionDir,
        transactionId: transaction.transactionId,
        schemaVersion: 1,
        backupDir: transaction.backupDir,
        channel: transaction.channel,
        currentVersion: transaction.currentVersion,
        dist: transaction.dist,
        installDir: transaction.installDir,
        stagingDir: transaction.stagingDir,
        targetVersion: transaction.targetVersion,
        error: error instanceof Error ? error.message : String(error),
    }
}

export async function applyBootstrapperTransaction(options: ApplyBootstrapperTransactionOptions): Promise<BootstrapperApplyTransactionResult> {
    const transactionFile = path.resolve(options.transactionFile)
    const startedAt = new Date().toISOString()
    const transaction = parsePreparedTransaction(JSON.parse(await fs.readFile(transactionFile, 'utf8')))
    const checks = [
        pass('transaction-state', 'Transaction is prepared'),
        ...(isInside(transaction.transactionDir, transactionFile)
            ? [pass('transaction-file-contained', 'Transaction file stays inside transaction directory', transactionFile)]
            : [block('transaction-file-contained', 'Transaction file must stay inside transaction directory', transactionFile)]),
        ...transaction.artifacts.flatMap(artifact => validateArtifactPaths(transaction, artifact)),
    ]
    const appliedArtifacts: BootstrapperAppliedArtifact[] = []

    if (checks.some(check => check.status === 'block')) {
        const result = createFailureResult(transaction, checks, startedAt, [], 'Transaction path validation failed')
        await writeTransactionState(transactionFile, result)
        return result
    }

    try {
        for (const artifact of transaction.artifacts) {
            appliedArtifacts.push(await applyArtifact(artifact, transaction))
        }

        const result: BootstrapperApplyTransactionResult = {
            ...transaction,
            state: 'applied',
            applied: true,
            applyStartedAt: startedAt,
            appliedAt: new Date().toISOString(),
            checks,
            artifacts: appliedArtifacts,
        }
        await writeTransactionState(transactionFile, result)
        return result
    } catch (error) {
        const failedArtifact = transaction.artifacts[appliedArtifacts.length]
        const failedArtifacts: BootstrapperAppliedArtifact[] = failedArtifact
            ? [
                  ...appliedArtifacts,
                  {
                      ...failedArtifact,
                      backupStatus: error instanceof ArtifactApplyError ? error.backupStatus : undefined,
                      error: error instanceof Error ? error.message : String(error),
                      message: 'Artifact apply failed',
                      status: 'failed',
                  },
              ]
            : appliedArtifacts
        const result = createFailureResult(transaction, checks, startedAt, failedArtifacts, error)
        await writeTransactionState(transactionFile, result)
        return result
    }
}
