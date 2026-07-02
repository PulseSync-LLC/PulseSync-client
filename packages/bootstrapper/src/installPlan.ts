import fs from 'node:fs/promises'
import path from 'node:path'
import type { BootstrapperArtifact } from './manifest.js'
import {
    defaultArtifactKeys,
    getArtifactFileName,
    sanitizePathSegment,
    verifyArtifactFile,
    type BootstrapperArtifactKey,
} from './staging.js'
import type { BootstrapperUpdateDecision } from './updateCheck.js'

export type BootstrapperInstallArtifactAction = 'replace-file' | 'replace-directory-archive'

export type BootstrapperInstallPlanArtifact = {
    action: BootstrapperInstallArtifactAction
    backupPath: string
    key: Extract<BootstrapperArtifactKey, 'app' | 'nativeModules'>
    sha256: string
    size: number
    sourcePath: string
    targetPath: string
}

export type BootstrapperInstallPreflight = {
    id: string
    message: string
    path?: string
    status: 'block' | 'pass'
}

export type BootstrapperInstallPlan = {
    artifacts: BootstrapperInstallPlanArtifact[]
    backupDir: string
    channel: string
    currentVersion: string
    dist: string
    executable: boolean
    installDir: string
    preflight: BootstrapperInstallPreflight[]
    stagingDir: string
    targetVersion: string
    updateAvailable: boolean
}

export type CreateBootstrapperInstallPlanOptions = {
    artifactKeys?: BootstrapperArtifactKey[]
    backupDir?: string
    installDir: string
    stagingRootDir: string
}

const installArtifactKeys = new Set<BootstrapperArtifactKey>(defaultArtifactKeys)

function pass(id: string, message: string, pathValue?: string): BootstrapperInstallPreflight {
    return {
        id,
        message,
        ...(pathValue ? { path: pathValue } : {}),
        status: 'pass',
    }
}

function block(id: string, message: string, pathValue?: string): BootstrapperInstallPreflight {
    return {
        id,
        message,
        ...(pathValue ? { path: pathValue } : {}),
        status: 'block',
    }
}

function isInside(parentDir: string, childPath: string): boolean {
    const relativePath = path.relative(parentDir, childPath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function getPlanStagingDir(decision: BootstrapperUpdateDecision, stagingRootDir: string): string {
    return path.resolve(
        stagingRootDir,
        sanitizePathSegment(decision.channel),
        sanitizePathSegment(decision.targetVersion),
        sanitizePathSegment(decision.dist),
    )
}

function getDefaultBackupDir(decision: BootstrapperUpdateDecision, stagingRootDir: string): string {
    return path.resolve(
        stagingRootDir,
        'backups',
        sanitizePathSegment(decision.channel),
        sanitizePathSegment(decision.targetVersion),
        sanitizePathSegment(decision.dist),
    )
}

function getTargetPath(installDir: string, key: BootstrapperInstallPlanArtifact['key'], artifactFileName: string): string {
    if (key === 'nativeModules') {
        return path.join(installDir, 'modules')
    }

    return path.join(installDir, '.updates', artifactFileName)
}

function getBackupPath(backupDir: string, key: BootstrapperInstallPlanArtifact['key'], artifactFileName: string): string {
    if (key === 'nativeModules') {
        return path.join(backupDir, 'modules')
    }

    return path.join(backupDir, 'app', artifactFileName)
}

function getAction(key: BootstrapperInstallPlanArtifact['key']): BootstrapperInstallArtifactAction {
    return key === 'nativeModules' ? 'replace-directory-archive' : 'replace-file'
}

async function checkInstallDir(installDir: string): Promise<BootstrapperInstallPreflight> {
    try {
        const stat = await fs.stat(installDir)
        if (!stat.isDirectory()) {
            return block('install-dir-directory', 'Install path exists but is not a directory', installDir)
        }

        return pass('install-dir-directory', 'Install directory exists', installDir)
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (code === 'ENOENT') {
            return block('install-dir-directory', 'Install directory does not exist', installDir)
        }

        return block('install-dir-directory', `Install directory cannot be inspected: ${error instanceof Error ? error.message : String(error)}`, installDir)
    }
}

function selectInstallArtifactKeys(keys: BootstrapperArtifactKey[] | undefined): Array<BootstrapperInstallPlanArtifact['key']> {
    const requested = keys?.length ? keys : defaultArtifactKeys
    const selected = requested.filter((key): key is BootstrapperInstallPlanArtifact['key'] => installArtifactKeys.has(key) && key !== 'bootstrapper')
    return Array.from(new Set(selected))
}

function getUnsupportedInstallArtifactKeys(keys: BootstrapperArtifactKey[] | undefined): BootstrapperArtifactKey[] {
    if (!keys?.length) {
        return []
    }

    return Array.from(new Set(keys.filter(key => !installArtifactKeys.has(key) || key === 'bootstrapper')))
}

function getDecisionArtifact(decision: BootstrapperUpdateDecision, key: BootstrapperInstallPlanArtifact['key']): BootstrapperArtifact | undefined {
    return decision.artifacts?.[key]
}

async function createArtifactPlanEntry(
    decision: BootstrapperUpdateDecision,
    key: BootstrapperInstallPlanArtifact['key'],
    installDir: string,
    stagingDir: string,
    backupDir: string,
): Promise<{ artifact?: BootstrapperInstallPlanArtifact; preflight: BootstrapperInstallPreflight[] }> {
    const artifact = getDecisionArtifact(decision, key)
    if (!artifact) {
        return {
            preflight: [block(`manifest-${key}`, `Manifest does not include ${key} artifact`)],
        }
    }

    const artifactFileName = getArtifactFileName(artifact, key)
    const sourcePath = path.join(stagingDir, artifactFileName)
    const targetPath = getTargetPath(installDir, key, artifactFileName)
    const backupPath = getBackupPath(backupDir, key, artifactFileName)
    const preflight: BootstrapperInstallPreflight[] = []

    if (isInside(stagingDir, sourcePath)) {
        preflight.push(pass(`staged-${key}-path`, `${key} staged path stays inside staging directory`, sourcePath))
    } else {
        preflight.push(block(`staged-${key}-path`, `${key} staged path escapes staging directory`, sourcePath))
    }

    if (isInside(installDir, targetPath)) {
        preflight.push(pass(`target-${key}-path`, `${key} target path stays inside install directory`, targetPath))
    } else {
        preflight.push(block(`target-${key}-path`, `${key} target path escapes install directory`, targetPath))
    }

    if (isInside(backupDir, backupPath)) {
        preflight.push(pass(`backup-${key}-path`, `${key} backup path stays inside backup directory`, backupPath))
    } else {
        preflight.push(block(`backup-${key}-path`, `${key} backup path escapes backup directory`, backupPath))
    }

    try {
        const verified = await verifyArtifactFile(sourcePath, artifact, key)
        preflight.push(pass(`staged-${key}-artifact`, `${key} staged artifact exists and matches manifest hash`, sourcePath))
        return {
            artifact: {
                action: getAction(key),
                backupPath,
                key,
                sha256: verified.sha256,
                size: verified.size,
                sourcePath,
                targetPath,
            },
            preflight,
        }
    } catch (error) {
        preflight.push(
            block(
                `staged-${key}-artifact`,
                `${key} staged artifact is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
                sourcePath,
            ),
        )
        return { preflight }
    }
}

export async function createBootstrapperInstallPlan(
    decision: BootstrapperUpdateDecision,
    options: CreateBootstrapperInstallPlanOptions,
): Promise<BootstrapperInstallPlan> {
    const installDir = path.resolve(options.installDir)
    const stagingRootDir = path.resolve(options.stagingRootDir)
    const stagingDir = getPlanStagingDir(decision, stagingRootDir)
    const backupDir = path.resolve(options.backupDir ?? getDefaultBackupDir(decision, stagingRootDir))
    const preflight: BootstrapperInstallPreflight[] = []
    const artifacts: BootstrapperInstallPlanArtifact[] = []

    if (decision.updateAvailable) {
        preflight.push(pass('update-available', 'Update is available'))
    } else {
        preflight.push(block('update-available', `Update is not available: ${decision.reason}`))
    }

    if (decision.artifacts) {
        preflight.push(pass('manifest-dist-artifacts', 'Manifest includes artifacts for this dist'))
    } else {
        preflight.push(block('manifest-dist-artifacts', `Manifest does not include artifacts for ${decision.dist}`))
    }

    preflight.push(await checkInstallDir(installDir))

    if (decision.artifacts) {
        for (const key of getUnsupportedInstallArtifactKeys(options.artifactKeys)) {
            preflight.push(block(`artifact-${key}-unsupported`, `${key} is not supported by read-only install planning in this slice`))
        }

        for (const key of selectInstallArtifactKeys(options.artifactKeys)) {
            const result = await createArtifactPlanEntry(decision, key, installDir, stagingDir, backupDir)
            preflight.push(...result.preflight)
            if (result.artifact) {
                artifacts.push(result.artifact)
            }
        }
    }

    return {
        artifacts,
        backupDir,
        channel: decision.channel,
        currentVersion: decision.currentVersion,
        dist: decision.dist,
        executable: preflight.every(entry => entry.status === 'pass') && artifacts.length > 0,
        installDir,
        preflight,
        stagingDir,
        targetVersion: decision.targetVersion,
        updateAvailable: decision.updateAvailable,
    }
}
