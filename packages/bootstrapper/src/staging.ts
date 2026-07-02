import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { BootstrapperArtifact, BootstrapperDistArtifacts } from './manifest.js'
import type { BootstrapperUpdateDecision } from './updateCheck.js'

export type BootstrapperArtifactKey = keyof BootstrapperDistArtifacts

export type StagedBootstrapperArtifact = {
    key: BootstrapperArtifactKey
    path: string
    reused: boolean
    sha256: string
    size: number
    url: string
}

export type BootstrapperStagingResult = {
    artifacts: StagedBootstrapperArtifact[]
    channel: string
    dist: string
    reason: BootstrapperUpdateDecision['reason']
    stagingDir: string
    targetVersion: string
    updateAvailable: boolean
}

export const defaultArtifactKeys: BootstrapperArtifactKey[] = ['app', 'nativeModules']

export function sanitizePathSegment(value: string): string {
    const sanitized = value.replace(/[^a-z0-9._-]+/giu, '_').replace(/^_+|_+$/gu, '')
    if (!sanitized || sanitized === '.' || sanitized === '..') {
        throw new Error(`Invalid staging path segment: ${value}`)
    }
    return sanitized
}

export function getArtifactFileName(artifact: BootstrapperArtifact, key: BootstrapperArtifactKey): string {
    try {
        const url = new URL(artifact.url)
        const fileName = path.basename(decodeURIComponent(url.pathname))
        if (fileName) {
            return sanitizePathSegment(fileName)
        }
    } catch {}

    const fileName = path.basename(artifact.url)
    return sanitizePathSegment(fileName || `${key}.artifact`)
}

export async function sha256File(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fsSync.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

async function getFileSize(filePath: string): Promise<number> {
    return (await fs.stat(filePath)).size
}

export async function verifyArtifactFile(filePath: string, artifact: BootstrapperArtifact, key: BootstrapperArtifactKey): Promise<{ sha256: string; size: number }> {
    const size = await getFileSize(filePath)
    if (artifact.size !== undefined && artifact.size !== size) {
        throw new Error(`Downloaded ${key} size mismatch: expected ${artifact.size}, got ${size}`)
    }

    const sha256 = await sha256File(filePath)
    if (sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
        throw new Error(`Downloaded ${key} sha256 mismatch: expected ${artifact.sha256}, got ${sha256}`)
    }

    return { sha256, size }
}

async function copyLocalArtifact(source: string, targetPath: string): Promise<void> {
    if (source.startsWith('file://')) {
        await fs.copyFile(fileURLToPath(source), targetPath)
        return
    }

    await fs.copyFile(source, targetPath)
}

async function downloadHttpArtifact(url: string, targetPath: string): Promise<void> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to download artifact: ${response.status} ${response.statusText}`)
    }
    if (!response.body) {
        throw new Error('Failed to download artifact: response body is empty')
    }

    await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(targetPath))
}

async function materializeArtifact(artifact: BootstrapperArtifact, targetPath: string): Promise<void> {
    if (/^https?:\/\//iu.test(artifact.url)) {
        await downloadHttpArtifact(artifact.url, targetPath)
        return
    }

    await copyLocalArtifact(artifact.url, targetPath)
}

function getDecisionArtifact(decision: BootstrapperUpdateDecision, key: BootstrapperArtifactKey): BootstrapperArtifact | undefined {
    return decision.artifacts?.[key]
}

async function stageArtifact(
    decision: BootstrapperUpdateDecision,
    key: BootstrapperArtifactKey,
    artifact: BootstrapperArtifact,
    stagingDir: string,
): Promise<StagedBootstrapperArtifact> {
    const fileName = getArtifactFileName(artifact, key)
    const targetPath = path.join(stagingDir, fileName)

    if (fsSync.existsSync(targetPath)) {
        try {
            const verified = await verifyArtifactFile(targetPath, artifact, key)
            return {
                key,
                path: targetPath,
                reused: true,
                sha256: verified.sha256,
                size: verified.size,
                url: artifact.url,
            }
        } catch {
            await fs.rm(targetPath, { force: true })
        }
    }

    const tempPath = `${targetPath}.part-${process.pid}-${Date.now()}`
    try {
        await materializeArtifact(artifact, tempPath)
        const verified = await verifyArtifactFile(tempPath, artifact, key)
        await fs.rename(tempPath, targetPath)
        return {
            key,
            path: targetPath,
            reused: false,
            sha256: verified.sha256,
            size: verified.size,
            url: artifact.url,
        }
    } catch (error) {
        await fs.rm(tempPath, { force: true })
        throw error
    }
}

export async function stageBootstrapperArtifacts(
    decision: BootstrapperUpdateDecision,
    stagingRootDir: string,
    artifactKeys: BootstrapperArtifactKey[] = defaultArtifactKeys,
): Promise<BootstrapperStagingResult> {
    const stagingDir = path.resolve(
        stagingRootDir,
        sanitizePathSegment(decision.channel),
        sanitizePathSegment(decision.targetVersion),
        sanitizePathSegment(decision.dist),
    )
    await fs.mkdir(stagingDir, { recursive: true })

    if (!decision.updateAvailable || !decision.artifacts) {
        return {
            artifacts: [],
            channel: decision.channel,
            dist: decision.dist,
            reason: decision.reason,
            stagingDir,
            targetVersion: decision.targetVersion,
            updateAvailable: decision.updateAvailable,
        }
    }

    const stagedArtifacts: StagedBootstrapperArtifact[] = []
    for (const key of artifactKeys) {
        const artifact = getDecisionArtifact(decision, key)
        if (!artifact) {
            continue
        }

        stagedArtifacts.push(await stageArtifact(decision, key, artifact, stagingDir))
    }

    return {
        artifacts: stagedArtifacts,
        channel: decision.channel,
        dist: decision.dist,
        reason: decision.reason,
        stagingDir,
        targetVersion: decision.targetVersion,
        updateAvailable: decision.updateAvailable,
    }
}
