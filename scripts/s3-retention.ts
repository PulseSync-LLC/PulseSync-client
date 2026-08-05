import 'dotenv/config'
import path from 'path'
import chalk from 'chalk'
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'

enum LogLevel {
    INFO = 'INFO',
    SUCCESS = 'SUCCESS',
}

type StoredS3Object = {
    key: string
    lastModified: Date | null
    size: number
}

type VersionedArtifactDescriptor = {
    version: string
}

export type DesktopPruneSummary = {
    apply: boolean
    branch: string
    deleteBytes: number
    deleteCount: number
    keptManifestReleases: string[]
    protectedManifestReleases: string[]
    keptLegacyVersions: string[]
    scannedCount: number
}

const VERSIONED_ARTIFACT_RE = /^pulsesync-app-(.+)-([a-z0-9_-]+)\.([a-z0-9]+(?:\.[a-z0-9]+)?)$/iu
const SUPPORTED_ARTIFACT_SUFFIXES = new Set(['appimage', 'deb', 'dmg', 'dmg.blockmap', 'exe', 'exe.blockmap', 'rpm', 'tar.gz', 'zip'])

function log(level: LogLevel, message: string): void {
    const ts = new Date().toLocaleString()
    const tag = level === LogLevel.SUCCESS ? chalk.green('[SUCCESS]') : chalk.blue('[INFO] ')
    console.log(`${chalk.gray(ts)} ${tag} ${message}`)
}

function createS3Client(): S3Client {
    const bucket = process.env.S3_BUCKET
    if (!bucket) throw new Error('S3_BUCKET is not set in env')
    return new S3Client({
        region: process.env.S3_REGION,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
        maxAttempts: Number(process.env.S3_MAX_ATTEMPTS) || 3,
    })
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseVersionedArtifactDescriptor(key: string): VersionedArtifactDescriptor | null {
    const match = VERSIONED_ARTIFACT_RE.exec(path.basename(key))
    if (!match) return null

    const [, rawVersionPrefix, rawArchSuffix, rawSuffix] = match
    const suffix = rawSuffix.toLowerCase()
    if (!SUPPORTED_ARTIFACT_SUFFIXES.has(suffix)) return null

    const versionAndArchParts = `${rawVersionPrefix}-${rawArchSuffix}`.split('-')
    for (let index = versionAndArchParts.length - 1; index > 0; index -= 1) {
        const candidateVersion = versionAndArchParts.slice(0, index).join('-')
        const candidateArch = versionAndArchParts.slice(index).join('-').toLowerCase()
        if (!semver.valid(candidateVersion)) continue
        const hasExpectedArch =
            suffix === 'tar.gz'
                ? /^linux-[a-z0-9_]+$/u.test(candidateArch)
                : /^(?:x64|arm64|amd64|aarch64|ia32|x86_64|universal)$/u.test(candidateArch)
        if (hasExpectedArch) return { version: candidateVersion }
    }
    return null
}

function compareVersionsDesc(left: string, right: string): number {
    const leftValid = semver.valid(left)
    const rightValid = semver.valid(right)
    if (leftValid && rightValid) return semver.rcompare(leftValid, rightValid)
    if (leftValid) return -1
    if (rightValid) return 1
    return right.localeCompare(left)
}

function compareIntegerStringsDesc(left: string, right: string): number {
    const leftNumber = BigInt(left)
    const rightNumber = BigInt(right)
    return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? -1 : 1
}

async function listStoredObjects(client: S3Client, bucket: string, prefix: string): Promise<StoredS3Object[]> {
    const objects: StoredS3Object[] = []
    let continuationToken: string | undefined
    do {
        const response = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            }),
        )
        for (const object of response.Contents ?? []) {
            if (!object.Key) continue
            objects.push({
                key: object.Key,
                lastModified: object.LastModified ?? null,
                size: object.Size ?? 0,
            })
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)
    return objects
}

async function readStoredText(client: S3Client, bucket: string, key: string): Promise<string> {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!response.Body) throw new Error(`S3 object has no body: ${key}`)
    return await response.Body.transformToString('utf8')
}

function collectMetadataStrings(value: unknown, target: string[]): void {
    if (typeof value === 'string') {
        target.push(value)
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) collectMetadataStrings(item, target)
        return
    }
    if (typeof value === 'object' && value !== null) {
        for (const item of Object.values(value)) collectMetadataStrings(item, target)
    }
}

function resolveReferencedArtifactKey(rawValue: string, branchPrefix: string): string | null {
    const value = rawValue.trim()
    if (!value) return null
    if (/^https?:\/\//iu.test(value)) {
        try {
            return decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ''))
        } catch {
            return null
        }
    }

    const relative = value.split(/[?#]/u, 1)[0].replace(/^\.\//u, '').replace(/^\/+/, '')
    if (!relative || relative.includes('..')) return null
    return relative.startsWith(branchPrefix) ? relative : `${branchPrefix}${relative}`
}

function collectReferencedArtifactKeys(text: string, branchPrefix: string, existingKeys: Set<string>, target: Set<string>): void {
    const strings: string[] = []
    try {
        collectMetadataStrings(parseYaml(text), strings)
    } catch {
        strings.push(...Array.from(text.matchAll(/https?:\/\/[^"'\\\s]+/gu), match => match[0]))
    }
    for (const value of strings) {
        const key = resolveReferencedArtifactKey(value, branchPrefix)
        if (key && existingKeys.has(key)) target.add(key)
    }
}

function metadataDesktopVersion(text: string): string | null {
    try {
        const metadata = parseYaml(text) as { desktopVersion?: unknown }
        return typeof metadata?.desktopVersion === 'string' && semver.valid(metadata.desktopVersion) ? metadata.desktopVersion : null
    } catch {
        return null
    }
}

function setupRetentionFamily(branchPrefix: string, key: string): string | null {
    const parts = key.slice(branchPrefix.length).split('/')
    if (parts.length < 5 || parts[0] !== 'setups') return null
    return `${parts[2]}:${path.extname(parts.at(-1) ?? '').toLowerCase()}`
}

function topLevelVersionedArtifact(branchPrefix: string, key: string): VersionedArtifactDescriptor | null {
    const relative = key.slice(branchPrefix.length)
    if (!relative || relative.includes('/')) return null
    return parseVersionedArtifactDescriptor(relative)
}

export async function pruneUnreferencedDesktopArtifacts(
    branch: string,
    options?: { apply?: boolean; graceHours?: number; keepReleases?: number; prefix?: string; protectedReleaseIds?: string[] },
): Promise<DesktopPruneSummary> {
    if (!['dev', 'beta'].includes(branch)) throw new Error('Desktop S3 cleanup is restricted to the dev and beta branches')
    const bucket = process.env.S3_BUCKET
    if (!bucket) throw new Error('S3_BUCKET is not set in env')
    const prefix = (options?.prefix || 'builds/app').replace(/^\/+|\/+$/gu, '')
    const keepReleases = options?.keepReleases ?? 2
    const graceHours = options?.graceHours ?? 2
    const requestedProtectedReleases = new Set(options?.protectedReleaseIds ?? [])
    if (!Number.isSafeInteger(keepReleases) || keepReleases < 1 || keepReleases > 10) {
        throw new Error('keepReleases must be an integer from 1 to 10')
    }
    if (!Number.isFinite(graceHours) || graceHours < 1 || graceHours > 24 * 30) {
        throw new Error('graceHours must be from 1 to 720')
    }
    for (const release of requestedProtectedReleases) {
        if (!/^[1-9]\d*$/u.test(release)) throw new Error(`Invalid protected release ID: ${release}`)
    }

    const client = createS3Client()
    const branchPrefix = `${prefix}/${branch}/`
    const objects = await listStoredObjects(client, bucket, branchPrefix)
    if (objects.length === 0) {
        const summary: DesktopPruneSummary = {
            apply: options?.apply === true,
            branch,
            deleteBytes: 0,
            deleteCount: 0,
            keptManifestReleases: [],
            protectedManifestReleases: [],
            keptLegacyVersions: [],
            scannedCount: 0,
        }
        log(LogLevel.INFO, `No desktop artifacts found under ${branchPrefix}`)
        return summary
    }

    const existingKeys = new Set(objects.map(object => object.key))
    const archivePattern = new RegExp(
        `^${escapeRegExp(branchPrefix)}manifests/([1-9]\\d*)/(desktop-update-[a-z0-9_-]+\\.json)$`,
        'iu',
    )
    const archiveReleases = new Map<string, StoredS3Object[]>()
    for (const object of objects) {
        const match = archivePattern.exec(object.key)
        if (!match) continue
        const releaseObjects = archiveReleases.get(match[1]) ?? []
        releaseObjects.push(object)
        archiveReleases.set(match[1], releaseObjects)
    }

    const keptManifestReleases = Array.from(archiveReleases.keys()).sort(compareIntegerStringsDesc).slice(0, keepReleases)
    const protectedManifestReleases = Array.from(requestedProtectedReleases)
        .filter(release => archiveReleases.has(release))
        .sort(compareIntegerStringsDesc)
    const retainedManifestReleases = new Set([...keptManifestReleases, ...protectedManifestReleases])
    const keepKeys = new Set<string>()
    const metadataKeys = objects
        .filter(object => {
            const relative = object.key.slice(branchPrefix.length)
            return /^desktop-update-[a-z0-9_-]+\.json$/iu.test(relative) || relative === 'download.json' || /^latest[^/]*\.ya?ml$/iu.test(relative)
        })
        .map(object => object.key)
    for (const release of retainedManifestReleases) {
        for (const object of archiveReleases.get(release) ?? []) {
            metadataKeys.push(object.key)
            keepKeys.add(object.key)
        }
    }

    const currentManifestCount = metadataKeys.filter(key => /^desktop-update-[a-z0-9_-]+\.json$/iu.test(key.slice(branchPrefix.length))).length
    const retainedDesktopVersions = new Set<string>()
    for (const key of new Set(metadataKeys)) {
        const text = await readStoredText(client, bucket, key)
        collectReferencedArtifactKeys(text, branchPrefix, existingKeys, keepKeys)
        const desktopVersion = metadataDesktopVersion(text)
        if (desktopVersion) retainedDesktopVersions.add(desktopVersion)
    }
    if (currentManifestCount > 0 && ![...keepKeys].some(key => key.startsWith(`${branchPrefix}hosts/`) || key.startsWith(`${branchPrefix}bundles/`))) {
        throw new Error('Desktop manifests did not reference any host artifacts; cleanup aborted')
    }

    const topLevelVersionedObjects = objects
        .map(object => ({ descriptor: topLevelVersionedArtifact(branchPrefix, object.key), object }))
        .filter((entry): entry is { descriptor: VersionedArtifactDescriptor; object: StoredS3Object } => entry.descriptor !== null)
    const availableLegacyVersions = Array.from(new Set(topLevelVersionedObjects.map(entry => entry.descriptor.version))).sort(compareVersionsDesc)
    const keptLegacyVersions = retainedDesktopVersions.size
        ? availableLegacyVersions.filter(version => retainedDesktopVersions.has(version))
        : availableLegacyVersions.slice(0, keepReleases)
    const keptLegacyVersionSet = new Set(keptLegacyVersions)
    for (const entry of topLevelVersionedObjects) {
        if (keptLegacyVersionSet.has(entry.descriptor.version)) keepKeys.add(entry.object.key)
    }

    const managedRoots = new Set(['bundles', 'components', 'hosts', 'manifests', 'setups', 'versions'])
    const hasStructuredArtifacts = objects.some(object => managedRoots.has(object.key.slice(branchPrefix.length).split('/')[0]))
    if (currentManifestCount === 0 && hasStructuredArtifacts) {
        throw new Error(`Structured desktop artifacts exist without current manifests under ${branchPrefix}; cleanup aborted`)
    }
    if (currentManifestCount === 0 && topLevelVersionedObjects.length === 0) {
        throw new Error(`No recognized desktop artifacts found under ${branchPrefix}; cleanup aborted`)
    }

    const setupFamilies = new Map<string, StoredS3Object[]>()
    for (const object of objects) {
        const family = setupRetentionFamily(branchPrefix, object.key)
        if (!family) continue
        const familyObjects = setupFamilies.get(family) ?? []
        familyObjects.push(object)
        setupFamilies.set(family, familyObjects)
    }
    for (const familyObjects of setupFamilies.values()) {
        if (retainedDesktopVersions.size) {
            for (const object of familyObjects) {
                const setupVersion = object.key.slice(branchPrefix.length).split('/')[1]
                if (retainedDesktopVersions.has(setupVersion)) keepKeys.add(object.key)
            }
        } else {
            familyObjects.sort((left, right) => (right.lastModified?.getTime() ?? 0) - (left.lastModified?.getTime() ?? 0))
            for (const object of familyObjects.slice(0, keepReleases)) keepKeys.add(object.key)
        }
    }

    const cutoff = Date.now() - graceHours * 60 * 60 * 1000
    const deleteObjects = objects.filter(object => {
        const root = object.key.slice(branchPrefix.length).split('/')[0]
        const isManaged = managedRoots.has(root) || topLevelVersionedArtifact(branchPrefix, object.key) !== null
        if (!isManaged || keepKeys.has(object.key)) return false
        return object.lastModified !== null && object.lastModified.getTime() < cutoff
    })
    const deleteBytes = deleteObjects.reduce((total, object) => total + object.size, 0)

    if (options?.apply) {
        for (let index = 0; index < deleteObjects.length; index += 1000) {
            const chunk = deleteObjects.slice(index, index + 1000)
            await client.send(
                new DeleteObjectsCommand({
                    Bucket: bucket,
                    Delete: {
                        Objects: chunk.map(object => ({ Key: object.key })),
                        Quiet: true,
                    },
                }),
            )
        }
    }

    const summary: DesktopPruneSummary = {
        apply: options?.apply === true,
        branch,
        deleteBytes,
        deleteCount: deleteObjects.length,
        keptManifestReleases,
        protectedManifestReleases,
        keptLegacyVersions,
        scannedCount: objects.length,
    }
    log(
        options?.apply ? LogLevel.SUCCESS : LogLevel.INFO,
        `${options?.apply ? 'Removed' : 'Would remove'} ${summary.deleteCount} unreferenced ${branch} objects (${(deleteBytes / 1024 / 1024).toFixed(1)} MiB); kept manifest releases: ${keptManifestReleases.join(', ') || 'none'}; active protected releases: ${protectedManifestReleases.join(', ') || 'none'}; kept legacy versions: ${keptLegacyVersions.join(', ') || 'none'}`,
    )
    return summary
}
