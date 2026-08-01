import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import chalk from 'chalk'
import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
    UploadPartCommand,
} from '@aws-sdk/client-s3'
import { fileURLToPath, pathToFileURL } from 'node:url'
import semver from 'semver'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const S3_MULTIPART_MIN_PART_SIZE = 5 * 1024 * 1024
const S3_MULTIPART_DEFAULT_THRESHOLD = 16 * 1024 * 1024
const S3_MULTIPART_DEFAULT_PART_SIZE = 8 * 1024 * 1024
const S3_MULTIPART_DEFAULT_CONCURRENCY = 4

enum LogLevel {
    INFO = 'INFO',
    SUCCESS = 'SUCCESS',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

type UploadHeaders = {
    CacheControl?: string
    ContentType?: string
}

export type RemoteRendererPublishPlan = {
    buildNumber: string
    filesBeforePointers: string[]
    manifestPath: string
    publicEntrypointPath: string
}

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.otf': 'font/otf',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.yml': 'text/yaml; charset=utf-8',
}

function log(level: LogLevel, message: string): void {
    const ts = new Date().toLocaleString()
    const tag = {
        [LogLevel.INFO]: chalk.blue('[INFO] '),
        [LogLevel.SUCCESS]: chalk.green('[SUCCESS]'),
        [LogLevel.WARN]: chalk.yellow('[WARN] '),
        [LogLevel.ERROR]: chalk.red('[ERROR]'),
    }[level]
    const out = `${chalk.gray(ts)} ${tag} ${message}`
    if (level === LogLevel.ERROR) console.error(out)
    else console.log(out)
}

function createS3Client(): S3Client {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getMultipartUploadConfig() {
    const threshold = parsePositiveInteger(process.env.S3_MULTIPART_THRESHOLD, S3_MULTIPART_DEFAULT_THRESHOLD)
    const requestedPartSize = parsePositiveInteger(process.env.S3_MULTIPART_PART_SIZE, S3_MULTIPART_DEFAULT_PART_SIZE)
    const partSize = Math.max(requestedPartSize, S3_MULTIPART_MIN_PART_SIZE)
    const concurrency = Math.max(1, parsePositiveInteger(process.env.S3_MULTIPART_CONCURRENCY, S3_MULTIPART_DEFAULT_CONCURRENCY))

    return { threshold, partSize, concurrency }
}

async function readFileChunk(filePath: string, start: number, length: number): Promise<Buffer> {
    const handle = await fs.promises.open(filePath, 'r')
    try {
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, start)
        return bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
    } finally {
        await handle.close()
    }
}

function walkFiles(dir: string): string[] {
    return fs.readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name)
        return fs.statSync(full).isDirectory() ? walkFiles(full) : [full]
    })
}

function isLegacyUpdaterArtifact(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase()
    return fileName === 'download.json' || fileName.startsWith('latest') || fileName.endsWith('.blockmap')
}

function isLegacyUpdateBridgeMetadata(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase()
    return fileName === 'download.json' || fileName === 'latest.yml' || fileName === 'latest-linux.yml'
}

async function hashFileSha256(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
}

function isDesktopReleaseManifestFile(filePath: string): boolean {
    return /^desktop-update-[a-z0-9_-]+\.json$/iu.test(path.basename(filePath))
}

function getContentType(filePath: string): string | undefined {
    return CONTENT_TYPES_BY_EXTENSION[path.extname(filePath).toLowerCase()]
}

function getRemoteRendererUploadHeaders(relativePath: string, filePath: string): UploadHeaders {
    const normalizedPath = relativePath.replace(/\\/g, '/')
    const contentType = getContentType(filePath)
    const cacheControl =
        normalizedPath === 'desktop/manifest.json'
            ? 'no-store, no-cache, must-revalidate, max-age=0'
            : normalizedPath.startsWith('versions/')
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600'

    return {
        ...(contentType ? { ContentType: contentType } : {}),
        CacheControl: cacheControl,
    }
}

function getRemoteRendererPointerUploadHeaders(filePath: string): UploadHeaders {
    return {
        ...(getContentType(filePath) ? { ContentType: getContentType(filePath) } : {}),
        CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
    }
}

function getDesktopUpdateUploadHeaders(filePath: string): UploadHeaders | undefined {
    if (!isDesktopReleaseManifestFile(filePath) && !isLegacyUpdateBridgeMetadata(filePath)) {
        return undefined
    }

    return {
        ...(getContentType(filePath) ? { ContentType: getContentType(filePath) } : {}),
        CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
    }
}

function getLatestAliasUploadHeaders(filePath: string): UploadHeaders {
    return {
        ...(getContentType(filePath) ? { ContentType: getContentType(filePath) } : {}),
        CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

async function versionedPublishPath(filePath: string, version: string, dist: string, artifactPath: string): Promise<string> {
    const fileName = path.basename(filePath)
    const sha256 = await hashFileSha256(filePath)
    return `versions/${version}/${dist}/${artifactPath}/${sha256.slice(0, 16)}/${fileName}`
}

async function immutablePublishPath(filePath: string, prefix: string): Promise<string> {
    const sha256 = await hashFileSha256(filePath)
    return `${prefix}/${sha256.slice(0, 16)}/${path.basename(filePath)}`
}

export async function resolveStructuredPublishPath(filePath: string, version?: string): Promise<string> {
    const fileName = path.basename(filePath)
    if (isDesktopReleaseManifestFile(filePath)) {
        return fileName
    }
    if (!version) {
        return fileName
    }

    const escapedVersion = escapeRegExp(version)
    const hostMatch = /^pulsesync-host-(.+)-((?:win32|linux)-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (hostMatch) {
        const [, hostVersion, dist] = hostMatch
        return await immutablePublishPath(filePath, `hosts/${hostVersion}/${dist}`)
    }

    const hostFileMatch = /^pulsesync-host-file-(.+)-([a-f0-9]{16})-((?:win32|linux)-[a-z0-9_-]+)\.bin$/iu.exec(fileName)
    if (hostFileMatch) {
        const [, hostVersion, , dist] = hostFileMatch
        return await immutablePublishPath(filePath, `hosts/${hostVersion}/${dist}/files`)
    }

    const hostPatchMatch = /^pulsesync-host-patch-bsdiff-(.+)-([a-f0-9]{16})-([a-f0-9]{16})-((?:win32|linux)-[a-z0-9_-]+)\.patch$/iu.exec(fileName)
    if (hostPatchMatch) {
        const [, hostVersion, fromSha, , dist] = hostPatchMatch
        return await immutablePublishPath(filePath, `hosts/${hostVersion}/${dist}/patches/bsdiff/${fromSha}`)
    }

    const macosHostMatch = /^pulsesync-host-bundle-(.+)-(darwin-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (macosHostMatch) {
        const [, bundleVersion, dist] = macosHostMatch
        return await immutablePublishPath(filePath, `bundles/${bundleVersion}/${dist}`)
    }

    const bootstrapperMatch = /^pulsesync-bootstrapper-(.+)-((?:win32|darwin|linux)-[a-z0-9_-]+)(?:\.exe)?$/iu.exec(fileName)
    if (bootstrapperMatch) {
        const [, bootstrapperVersion, dist] = bootstrapperMatch
        return await immutablePublishPath(filePath, `components/bootstrapper/${bootstrapperVersion}/${dist}`)
    }

    const componentFileMatch = /^pulsesync-component-file-([a-z0-9_]+)-(.+)-([a-f0-9]{16})-((?:win32|darwin|linux)-[a-z0-9_-]+)\.bin$/iu.exec(
        fileName,
    )
    if (componentFileMatch) {
        const [, moduleName, componentVersion, , dist] = componentFileMatch
        return await immutablePublishPath(filePath, `components/${moduleName}/${componentVersion}/${dist}/files`)
    }

    const componentPatchMatch =
        /^pulsesync-component-patch-bsdiff-([a-z0-9_]+)-(.+)-([a-f0-9]{16})-([a-f0-9]{16})-((?:win32|darwin|linux)-[a-z0-9_-]+)\.patch$/iu.exec(
            fileName,
        )
    if (componentPatchMatch) {
        const [, moduleName, componentVersion, fromSha, , dist] = componentPatchMatch
        return await immutablePublishPath(filePath, `components/${moduleName}/${componentVersion}/${dist}/patches/bsdiff/${fromSha}`)
    }

    const componentMatch = /^pulsesync-component-([a-z0-9_]+)-(.+)-((?:win32|darwin|linux)-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (componentMatch) {
        const [, moduleName, componentVersion, dist] = componentMatch
        return await immutablePublishPath(filePath, `components/${moduleName}/${componentVersion}/${dist}`)
    }

    const moduleMatch = new RegExp(`^pulsesync-module-([a-z0-9_-]+)-${escapedVersion}-([a-z0-9_-]+)\\.zip$`, 'iu').exec(fileName)
    if (moduleMatch) {
        const [, moduleName, dist] = moduleMatch
        const sha256 = await hashFileSha256(filePath)
        const componentVersion = moduleName === 'desktopCore' ? version : sha256.slice(0, 16)
        return `components/${moduleName}/${componentVersion}/${dist}/${sha256.slice(0, 16)}/${fileName}`
    }

    const setupMatch = new RegExp(`^pulsesync-app-${escapedVersion}-([a-z0-9_-]+)\\.exe(?:\\.blockmap)?$`, 'iu').exec(fileName)
    if (setupMatch) {
        const arch = setupMatch[1].toLowerCase()
        return await immutablePublishPath(filePath, `setups/${version}/win32-${arch}`)
    }

    const macSetupMatch = new RegExp(`^pulsesync-app-${escapedVersion}-([a-z0-9_-]+)\\.dmg$`, 'iu').exec(fileName)
    if (macSetupMatch) {
        const arch = macSetupMatch[1].toLowerCase()
        return await immutablePublishPath(filePath, `setups/${version}/darwin-${arch}`)
    }

    return fileName
}

function resolveLatestAliasPublishPath(filePath: string, version?: string): string | null {
    if (!version) {
        return null
    }

    const fileName = path.basename(filePath)
    const escapedVersion = escapeRegExp(version)
    const setupMatch = new RegExp(`^pulsesync-app-${escapedVersion}-([a-z0-9_-]+)\\.exe$`, 'iu').exec(fileName)
    if (setupMatch) {
        const arch = setupMatch[1].toLowerCase()
        return `latest/win32-${arch}/PulseSyncSetup.exe`
    }

    const macSetupMatch = new RegExp(`^pulsesync-app-${escapedVersion}-([a-z0-9_-]+)\\.dmg$`, 'iu').exec(fileName)
    if (macSetupMatch) {
        const arch = macSetupMatch[1].toLowerCase()
        return `latest/darwin-${arch}/PulseSync.dmg`
    }

    return null
}

const VERSIONED_ARTIFACT_RE = /^pulsesync-app-(.+)-([a-z0-9_-]+)\.([a-z0-9]+(?:\.[a-z0-9]+)?)$/iu
const STRUCTURED_DIST_RE = /^(win32|darwin|linux)-([a-z0-9_-]+)$/iu

function parseKeepRecentVersions(rawValue?: string | null): number | null {
    if (!rawValue) return null
    const parsed = Number.parseInt(rawValue, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type ArtifactPlatform = 'win32' | 'darwin' | 'linux'

type VersionedArtifactDescriptor = {
    version: string
    arch: string
    platform: ArtifactPlatform
    suffix: string
    family: string
}

function resolveArtifactPlatform(suffix: string): ArtifactPlatform | null {
    switch (suffix) {
        case 'exe':
        case 'exe.blockmap':
            return 'win32'
        case 'dmg':
        case 'zip':
            return 'darwin'
        case 'deb':
        case 'rpm':
        case 'appimage':
        case 'tar.gz':
            return 'linux'
        default:
            return null
    }
}

function parseArtifactDist(dist: string): { platform: ArtifactPlatform; arch: string } | null {
    const match = STRUCTURED_DIST_RE.exec(dist)
    if (!match) return null

    return {
        platform: match[1].toLowerCase() as ArtifactPlatform,
        arch: match[2].toLowerCase(),
    }
}

function structuredArtifactDescriptor(version: string, dist: string, suffix: string, familyKind: string): VersionedArtifactDescriptor | null {
    const parsedDist = parseArtifactDist(dist)
    if (!parsedDist) return null

    return {
        version,
        arch: parsedDist.arch,
        platform: parsedDist.platform,
        suffix,
        family: `${parsedDist.platform}:${parsedDist.arch}:${familyKind}`,
    }
}

function parseStructuredArtifactDescriptor(fileName: string): VersionedArtifactDescriptor | null {
    const setupMatch = /^pulsesync-app-(.+)-([a-z0-9_-]+)\.exe$/iu.exec(fileName)
    if (setupMatch) {
        const [, version, arch] = setupMatch
        return structuredArtifactDescriptor(version, `win32-${arch}`, 'exe', 'setup')
    }

    const macSetupMatch = /^pulsesync-app-(.+)-([a-z0-9_-]+)\.dmg$/iu.exec(fileName)
    if (macSetupMatch) {
        const [, version, arch] = macSetupMatch
        return structuredArtifactDescriptor(version, `darwin-${arch}`, 'dmg', 'setup')
    }

    const hostMatch = /^pulsesync-host-(.+)-((?:win32|linux)-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (hostMatch) {
        const [, version, dist] = hostMatch
        return structuredArtifactDescriptor(version, dist, 'zip', 'host')
    }

    const hostFileMatch = /^pulsesync-host-file-(.+)-([a-f0-9]{16})-((?:win32|linux)-[a-z0-9_-]+)\.bin$/iu.exec(fileName)
    if (hostFileMatch) {
        const [, version, , dist] = hostFileMatch
        return structuredArtifactDescriptor(version, dist, 'bin', 'host-file')
    }

    const hostPatchMatch = /^pulsesync-host-patch-bsdiff-(.+)-([a-f0-9]{16})-([a-f0-9]{16})-((?:win32|linux)-[a-z0-9_-]+)\.patch$/iu.exec(fileName)
    if (hostPatchMatch) {
        const [, version, , , dist] = hostPatchMatch
        return structuredArtifactDescriptor(version, dist, 'patch', 'host-patch')
    }

    const macosHostMatch = /^pulsesync-host-bundle-(.+)-(darwin-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (macosHostMatch) {
        const [, version, dist] = macosHostMatch
        return structuredArtifactDescriptor(version, dist, 'zip', 'macos-host')
    }

    const bootstrapperMatch = /^pulsesync-bootstrapper-(.+)-((?:win32|darwin|linux)-[a-z0-9_-]+)(?:\.exe)?$/iu.exec(fileName)
    if (bootstrapperMatch) {
        const [, version, dist] = bootstrapperMatch
        return structuredArtifactDescriptor(version, dist, path.extname(fileName).toLowerCase() === '.exe' ? 'exe' : 'binary', 'bootstrapper')
    }

    const componentFileMatch = /^pulsesync-component-file-([a-z0-9_]+)-(.+)-([a-f0-9]{16})-((?:win32|darwin|linux)-[a-z0-9_-]+)\.bin$/iu.exec(
        fileName,
    )
    if (componentFileMatch) {
        const [, componentName, version, , dist] = componentFileMatch
        return structuredArtifactDescriptor(version, dist, 'bin', `component-file:${componentName.toLowerCase()}`)
    }

    const componentPatchMatch =
        /^pulsesync-component-patch-bsdiff-([a-z0-9_]+)-(.+)-([a-f0-9]{16})-([a-f0-9]{16})-((?:win32|darwin|linux)-[a-z0-9_-]+)\.patch$/iu.exec(
            fileName,
        )
    if (componentPatchMatch) {
        const [, componentName, version, , , dist] = componentPatchMatch
        return structuredArtifactDescriptor(version, dist, 'patch', `component-patch:${componentName.toLowerCase()}`)
    }

    const moduleMatch = /^pulsesync-module-([a-z0-9_-]+)-(.+)-((?:win32|darwin|linux)-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (moduleMatch) {
        const [, moduleName, version, dist] = moduleMatch
        return structuredArtifactDescriptor(version, dist, 'zip', `module:${moduleName.toLowerCase()}`)
    }

    const componentMatch = /^pulsesync-component-([a-z0-9_]+)-(.+)-((?:win32|darwin|linux)-[a-z0-9_-]+)\.zip$/iu.exec(fileName)
    if (componentMatch) {
        const [, componentName, version, dist] = componentMatch
        return structuredArtifactDescriptor(version, dist, 'zip', `component:${componentName.toLowerCase()}`)
    }

    return null
}

function parseVersionedArtifactDescriptor(key: string): VersionedArtifactDescriptor | null {
    const fileName = path.basename(key)
    const structuredDescriptor = parseStructuredArtifactDescriptor(fileName)
    if (structuredDescriptor) return structuredDescriptor

    const match = VERSIONED_ARTIFACT_RE.exec(fileName)
    if (!match) return null

    const [, version, rawArch, rawSuffix] = match
    const arch = rawArch.toLowerCase()
    const suffix = rawSuffix.toLowerCase()
    const platform = resolveArtifactPlatform(suffix)
    if (!platform) return null

    return {
        version,
        arch,
        platform,
        suffix,
        family: `${platform}:${arch}:${suffix}`,
    }
}

function collectCurrentArtifactVersions(filePaths: string[]): Map<string, Set<string>> {
    const families = new Map<string, Set<string>>()
    for (const filePath of filePaths) {
        const descriptor = parseVersionedArtifactDescriptor(filePath)
        if (!descriptor) continue
        const versions = families.get(descriptor.family) ?? new Set<string>()
        versions.add(descriptor.version)
        families.set(descriptor.family, versions)
    }
    return families
}

function compareVersionsDesc(left: string, right: string): number {
    if (/^\d+$/u.test(left) && /^\d+$/u.test(right)) {
        const leftNumber = BigInt(left)
        const rightNumber = BigInt(right)
        return leftNumber === rightNumber ? 0 : leftNumber > rightNumber ? -1 : 1
    }
    const leftValid = semver.valid(left)
    const rightValid = semver.valid(right)

    if (leftValid && rightValid) {
        return semver.rcompare(leftValid, rightValid)
    }
    if (leftValid) return -1
    if (rightValid) return 1
    return right.localeCompare(left)
}

async function pruneOldArtifacts(
    client: S3Client,
    bucket: string,
    prefix: string,
    branch: string,
    keepRecentVersions: number,
    currentArtifactVersions: Map<string, Set<string>>,
): Promise<void> {
    const branchPrefix = `${prefix}/${branch}/`
    const familyToVersionedKeys = new Map<string, Map<string, string[]>>()
    let continuationToken: string | undefined

    do {
        const response = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: branchPrefix,
                ContinuationToken: continuationToken,
            }),
        )

        for (const object of response.Contents ?? []) {
            if (!object.Key) continue
            const descriptor = parseVersionedArtifactDescriptor(object.Key)
            if (!descriptor || !currentArtifactVersions.has(descriptor.family)) continue

            const versionToKeys = familyToVersionedKeys.get(descriptor.family) ?? new Map<string, string[]>()
            const keys = versionToKeys.get(descriptor.version) ?? []
            keys.push(object.Key)
            versionToKeys.set(descriptor.version, keys)
            familyToVersionedKeys.set(descriptor.family, versionToKeys)
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    if (!familyToVersionedKeys.size) {
        log(LogLevel.INFO, `Retention skipped for ${branchPrefix}: no existing matching versioned artifacts found`)
        return
    }

    const keysToDelete: string[] = []
    const removedGroups: string[] = []
    for (const [family, versionToKeys] of familyToVersionedKeys.entries()) {
        const currentVersions = currentArtifactVersions.get(family) ?? new Set<string>()
        for (const currentVersion of currentVersions) {
            if (!versionToKeys.has(currentVersion)) {
                versionToKeys.set(currentVersion, [])
            }
        }

        const sortedVersions = Array.from(versionToKeys.keys()).sort(compareVersionsDesc)
        const keptVersions = new Set(sortedVersions.slice(0, keepRecentVersions))
        for (const currentVersion of currentVersions) keptVersions.add(currentVersion)

        const familyKeysToDelete = Array.from(versionToKeys.entries())
            .filter(([version]) => !keptVersions.has(version))
            .flatMap(([, keys]) => keys)

        if (!familyKeysToDelete.length) {
            continue
        }

        keysToDelete.push(...familyKeysToDelete)
        removedGroups.push(`${family} => ${sortedVersions.filter(version => !keptVersions.has(version)).join(', ')}`)
    }

    if (!keysToDelete.length) {
        const familyList = Array.from(currentArtifactVersions.keys()).sort().join(', ')
        log(LogLevel.INFO, `Retention skipped for ${branchPrefix}: nothing to delete for ${familyList}`)
        return
    }

    for (let index = 0; index < keysToDelete.length; index += 1000) {
        const chunk = keysToDelete.slice(index, index + 1000)
        await client.send(
            new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                    Objects: chunk.map(Key => ({ Key })),
                    Quiet: false,
                },
            }),
        )
    }

    log(LogLevel.SUCCESS, `Retention removed ${keysToDelete.length} artifacts from ${branchPrefix} (${removedGroups.join(' | ')})`)
}

async function uploadFileToS3(client: S3Client, bucket: string, key: string, filePath: string, headers?: UploadHeaders): Promise<void> {
    const { size } = await fs.promises.stat(filePath)
    const { threshold, partSize, concurrency } = getMultipartUploadConfig()
    const defaultUploadHeaders = isDesktopReleaseManifestFile(filePath)
        ? {
              CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
              ContentType: 'application/json; charset=utf-8',
          }
        : /\/(?:versions|hosts|components|setups)\//u.test(`/${key}`)
          ? {
                CacheControl: 'public, max-age=31536000, immutable',
            }
          : {}
    const uploadHeaders = {
        ...defaultUploadHeaders,
        ...headers,
    }

    if (size < threshold) {
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: fs.createReadStream(filePath),
                ACL: 'public-read',
                ...uploadHeaders,
            }),
        )
        log(LogLevel.INFO, `Uploaded ${key} (${Math.ceil(size / 1024)} KiB, single-part)`)
        return
    }

    const createResponse = await client.send(
        new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            ACL: 'public-read',
            ...uploadHeaders,
        }),
    )

    const uploadId = createResponse.UploadId
    if (!uploadId) {
        throw new Error(`Failed to start multipart upload for ${key}: missing UploadId`)
    }

    const partCount = Math.ceil(size / partSize)
    const completedParts = new Array<{ ETag: string; PartNumber: number }>(partCount)
    let nextPartNumber = 1
    let uploadedBytes = 0
    let finishedParts = 0

    log(
        LogLevel.INFO,
        `Uploading ${key} via multipart (${(size / 1024 / 1024).toFixed(1)} MiB, ${partCount} parts x ${(partSize / 1024 / 1024).toFixed(1)} MiB, concurrency ${concurrency})`,
    )

    try {
        const uploadWorker = async () => {
            while (true) {
                const partNumber = nextPartNumber++
                if (partNumber > partCount) return

                const start = (partNumber - 1) * partSize
                const contentLength = Math.min(size - start, partSize)
                const body = await readFileChunk(filePath, start, contentLength)

                const uploadPartResponse = await client.send(
                    new UploadPartCommand({
                        Bucket: bucket,
                        Key: key,
                        UploadId: uploadId,
                        PartNumber: partNumber,
                        Body: body,
                        ContentLength: contentLength,
                    }),
                )

                if (!uploadPartResponse.ETag) {
                    throw new Error(`Failed to upload part ${partNumber} for ${key}: missing ETag`)
                }

                completedParts[partNumber - 1] = {
                    ETag: uploadPartResponse.ETag,
                    PartNumber: partNumber,
                }
                uploadedBytes += contentLength
                finishedParts += 1

                log(LogLevel.INFO, `Uploaded part ${partNumber}/${partCount} for ${key} (${Math.round((uploadedBytes / size) * 100)}%)`)
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, partCount) }, () => uploadWorker()))

        await client.send(
            new CompleteMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
                MultipartUpload: {
                    Parts: completedParts,
                },
            }),
        )
    } catch (error) {
        await client.send(
            new AbortMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: uploadId,
            }),
        )
        throw error
    }

    log(LogLevel.INFO, `Uploaded ${key} (${finishedParts} parts, multipart)`)
}

export async function publishToS3(
    branch: string,
    dir: string,
    version?: string,
    opts?: { prefix?: string; keepRecentVersions?: number | null; legacyUpdateBridge?: boolean },
): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }
    const prefix = (opts?.prefix || 'builds/app').replace(/^\/+|\/+$/g, '')
    const keepRecentVersions = opts?.keepRecentVersions ?? parseKeepRecentVersions(process.env.S3_KEEP_RECENT_VERSIONS)
    const legacyUpdateBridge = opts?.legacyUpdateBridge === true
    const client = createS3Client()

    let files = fs
        .readdirSync(dir)
        .map(name => path.join(dir, name))
        .filter(filePath => fs.statSync(filePath).isFile())
        .filter(fp => path.basename(fp) !== 'builder-debug.yml')
        .filter(fp => !isLegacyUpdaterArtifact(fp) || (legacyUpdateBridge && isLegacyUpdateBridgeMetadata(fp)))
        .filter(fp =>
            version
                ? isDesktopReleaseManifestFile(fp) ||
                  (legacyUpdateBridge && isLegacyUpdateBridgeMetadata(fp)) ||
                  parseStructuredArtifactDescriptor(path.basename(fp)) !== null
                : true,
        )
    const currentArtifactVersions = collectCurrentArtifactVersions(files)

    const zipFiles = fs
        .readdirSync(dir)
        .filter(name => name.endsWith('.zip'))
        .map(name => path.join(dir, name))
    for (const zipPath of zipFiles) if (!files.includes(zipPath)) files.push(zipPath)

    const isMutableUpdatePointer = (filePath: string) => isDesktopReleaseManifestFile(filePath) || isLegacyUpdateBridgeMetadata(filePath)
    files = [...files.filter(filePath => !isMutableUpdatePointer(filePath)), ...files.filter(isMutableUpdatePointer)]

    if (version && keepRecentVersions && currentArtifactVersions.size) {
        await pruneOldArtifacts(client, bucket, prefix, branch, keepRecentVersions, currentArtifactVersions)
    }

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/${prefix}/${branch}/`)

    for (const filePath of files) {
        const key = `${prefix}/${branch}/${await resolveStructuredPublishPath(filePath, version)}`
        await uploadFileToS3(client, bucket, key, filePath, getDesktopUpdateUploadHeaders(filePath))
        const latestAliasPath = resolveLatestAliasPublishPath(filePath, version)
        if (latestAliasPath) {
            await uploadFileToS3(client, bucket, `${prefix}/${branch}/${latestAliasPath}`, filePath, getLatestAliasUploadHeaders(filePath))
        }
        if (legacyUpdateBridge && version) {
            const escapedVersion = escapeRegExp(version)
            if (new RegExp(`^pulsesync-app-${escapedVersion}-[a-z0-9_-]+\\.exe$`, 'iu').test(path.basename(filePath))) {
                await uploadFileToS3(client, bucket, `${prefix}/${branch}/${path.basename(filePath)}`, filePath, {
                    CacheControl: 'public, max-age=31536000, immutable',
                })
            }
        }
    }

    log(LogLevel.SUCCESS, 'Publish to S3 completed')
}

export function createRemoteRendererPublishPlan(dir: string): RemoteRendererPublishPlan {
    const rootDir = path.resolve(dir)
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        throw new Error(`Publish directory does not exist: ${rootDir}`)
    }

    const manifestPath = path.join(rootDir, 'desktop', 'manifest.json')
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
        throw new Error(`Remote renderer manifest does not exist: ${manifestPath}`)
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { buildNumber?: unknown; url?: unknown }
    if (typeof manifest.buildNumber !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(manifest.buildNumber)) {
        throw new Error(`Remote renderer manifest has an invalid buildNumber: ${String(manifest.buildNumber)}`)
    }
    if (typeof manifest.url !== 'string') {
        throw new Error('Remote renderer manifest has an invalid URL')
    }

    const rendererUrl = new URL(manifest.url)
    const expectedPathSuffix = `/versions/${manifest.buildNumber}/index.html`
    if (!rendererUrl.pathname.endsWith(expectedPathSuffix)) {
        throw new Error(`Remote renderer URL must end with ${expectedPathSuffix}: ${manifest.url}`)
    }

    const publicEntrypointPath = path.join(rootDir, 'versions', manifest.buildNumber, 'index.html')
    if (!fs.existsSync(publicEntrypointPath) || !fs.statSync(publicEntrypointPath).isFile()) {
        throw new Error(`Remote renderer public entrypoint does not exist: ${publicEntrypointPath}`)
    }

    const rootEntrypointPath = path.join(rootDir, 'index.html')
    const filesBeforePointers = walkFiles(rootDir)
        .filter(filePath => filePath !== manifestPath && filePath !== rootEntrypointPath)
        .sort((left, right) => left.localeCompare(right))

    return {
        buildNumber: manifest.buildNumber,
        filesBeforePointers,
        manifestPath,
        publicEntrypointPath,
    }
}

export async function publishDirectoryToS3(dir: string, opts?: { prefix?: string }): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }

    const rootDir = path.resolve(dir)
    const plan = createRemoteRendererPublishPlan(rootDir)

    const prefix = (opts?.prefix || process.env.S3_PREFIX || 'app').replace(/^\/+|\/+$/g, '')
    const client = createS3Client()

    log(
        LogLevel.INFO,
        `Publishing renderer build ${plan.buildNumber} (${plan.filesBeforePointers.length} immutable/shared files, then public alias, then manifest) to s3://${bucket}/${prefix}/`,
    )

    for (const filePath of plan.filesBeforePointers) {
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/')
        const key = `${prefix}/${relativePath}`
        await uploadFileToS3(client, bucket, key, filePath, getRemoteRendererUploadHeaders(relativePath, filePath))
    }

    await uploadFileToS3(
        client,
        bucket,
        `${prefix}/index.html`,
        plan.publicEntrypointPath,
        getRemoteRendererPointerUploadHeaders(plan.publicEntrypointPath),
    )
    await uploadFileToS3(
        client,
        bucket,
        `${prefix}/desktop/manifest.json`,
        plan.manifestPath,
        getRemoteRendererPointerUploadHeaders(plan.manifestPath),
    )

    log(LogLevel.SUCCESS, 'Publish directory to S3 completed')
}

function readPkgVersion(): string {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { version: string }
    return pkg.version
}

function argValue(flag: string): string | null {
    const i = process.argv.indexOf(flag)
    if (i === -1) return null
    return process.argv[i + 1] || null
}

async function cli(): Promise<void> {
    const branch = argValue('--branch') || argValue('-b')
    if (!branch) {
        log(LogLevel.ERROR, 'Usage: tsx scripts/s3-upload.ts --branch <name> [--dir release] [--version x.y.z] [--prefix builds/app]')
        process.exit(1)
    }
    const dir = argValue('--dir') || 'release'
    const version = argValue('--version') || readPkgVersion()
    const prefix = argValue('--prefix') || process.env.S3_PREFIX || 'builds/app'
    const keepRecentVersions = parseKeepRecentVersions(argValue('--keep-last') || argValue('--keepLast') || process.env.S3_KEEP_RECENT_VERSIONS)

    log(LogLevel.INFO, `Branch: ${branch}`)
    log(LogLevel.INFO, `Dir: ${dir}`)
    log(LogLevel.INFO, `Version: ${version}`)
    log(LogLevel.INFO, `Prefix: ${prefix}`)
    log(LogLevel.INFO, `Retention keep recent versions: ${keepRecentVersions ?? 'OFF'}`)

    await publishToS3(branch, dir, version, { prefix, keepRecentVersions })
}

const isDirectRun = process.argv[1] != null && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectRun) {
    cli().catch(err => {
        log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
        if (err && err.stack) {
            console.error(chalk.red(err.stack))
        }
        process.exit(1)
    })
}
