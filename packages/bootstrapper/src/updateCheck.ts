import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseBootstrapperManifest, type BootstrapperDistArtifacts, type BootstrapperUpdateManifest } from './manifest.js'

export type BootstrapperUpdateDecision = {
    artifacts?: BootstrapperDistArtifacts
    channel: string
    currentVersion: string
    dist: string
    reason: 'update-available' | 'up-to-date' | 'missing-dist-artifacts' | 'invalid-version'
    targetVersion: string
    updateAvailable: boolean
}

export async function loadManifestText(manifestUrl: string): Promise<string> {
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

export async function loadBootstrapperManifest(manifestUrl: string): Promise<BootstrapperUpdateManifest> {
    return parseBootstrapperManifest(JSON.parse(await loadManifestText(manifestUrl)))
}

type ComparableVersion = {
    major: number
    minor: number
    patch: number
    prerelease: string[]
}

function parseComparableVersion(version: string): ComparableVersion | null {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version.trim())
    if (!match) {
        return null
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4]?.split('.') ?? [],
    }
}

function comparePrereleaseIdentifier(left: string, right: string): number {
    const leftNumber = /^\d+$/u.test(left) ? Number(left) : null
    const rightNumber = /^\d+$/u.test(right) ? Number(right) : null

    if (leftNumber !== null && rightNumber !== null) {
        return Math.sign(leftNumber - rightNumber)
    }
    if (leftNumber !== null) {
        return -1
    }
    if (rightNumber !== null) {
        return 1
    }

    return left.localeCompare(right)
}

function compareVersions(left: ComparableVersion, right: ComparableVersion): number {
    for (const key of ['major', 'minor', 'patch'] as const) {
        const diff = left[key] - right[key]
        if (diff !== 0) {
            return Math.sign(diff)
        }
    }

    if (!left.prerelease.length && !right.prerelease.length) {
        return 0
    }
    if (!left.prerelease.length) {
        return 1
    }
    if (!right.prerelease.length) {
        return -1
    }

    const length = Math.max(left.prerelease.length, right.prerelease.length)
    for (let index = 0; index < length; index += 1) {
        const leftIdentifier = left.prerelease[index]
        const rightIdentifier = right.prerelease[index]
        if (leftIdentifier == null) {
            return -1
        }
        if (rightIdentifier == null) {
            return 1
        }

        const diff = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier)
        if (diff !== 0) {
            return diff
        }
    }

    return 0
}

export function decideBootstrapperUpdate(manifest: BootstrapperUpdateManifest, currentVersion: string, dist: string): BootstrapperUpdateDecision {
    const artifacts = manifest.artifacts[dist]
    if (!artifacts) {
        return {
            channel: manifest.channel,
            currentVersion,
            dist,
            reason: 'missing-dist-artifacts',
            targetVersion: manifest.clientVersion,
            updateAvailable: false,
        }
    }

    const current = parseComparableVersion(currentVersion)
    const target = parseComparableVersion(manifest.clientVersion)
    if (!current || !target) {
        return {
            artifacts,
            channel: manifest.channel,
            currentVersion,
            dist,
            reason: 'invalid-version',
            targetVersion: manifest.clientVersion,
            updateAvailable: false,
        }
    }

    const updateAvailable = compareVersions(target, current) > 0
    return {
        artifacts,
        channel: manifest.channel,
        currentVersion,
        dist,
        reason: updateAvailable ? 'update-available' : 'up-to-date',
        targetVersion: manifest.clientVersion,
        updateAvailable,
    }
}
