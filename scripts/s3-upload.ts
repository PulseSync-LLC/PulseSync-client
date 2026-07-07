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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

async function versionedPublishPath(filePath: string, version: string, dist: string, artifactPath: string): Promise<string> {
    const fileName = path.basename(filePath)
    const sha256 = await hashFileSha256(filePath)
    return `versions/${version}/${dist}/${artifactPath}/${sha256.slice(0, 16)}/${fileName}`
}

async function resolveStructuredPublishPath(filePath: string, version?: string): Promise<string> {
    const fileName = path.basename(filePath)
    if (isDesktopReleaseManifestFile(filePath)) {
        return fileName
    }
    if (!version) {
        return fileName
    }

    const escapedVersion = escapeRegExp(version)
    const appPayloadMatch = new RegExp(`^pulsesync-app-payload-${escapedVersion}-([a-z0-9_-]+)\\.zip$`, 'iu').exec(fileName)
    if (appPayloadMatch) {
        const dist = appPayloadMatch[1]
        return await versionedPublishPath(filePath, version, dist, 'app')
    }

    const bootstrapperMatch = new RegExp(`^pulsesync-bootstrapper-${escapedVersion}-([a-z0-9_-]+)(?:\\.exe)?$`, 'iu').exec(fileName)
    if (bootstrapperMatch) {
        const dist = bootstrapperMatch[1]
        return await versionedPublishPath(filePath, version, dist, 'bootstrapper')
    }

    const moduleMatch = new RegExp(`^pulsesync-module-([a-z0-9_-]+)-${escapedVersion}-([a-z0-9_-]+)\\.zip$`, 'iu').exec(fileName)
    if (moduleMatch) {
        const [, moduleName, dist] = moduleMatch
        return await versionedPublishPath(filePath, version, dist, `modules/${moduleName}`)
    }

    const setupMatch = new RegExp(`^pulsesync-bootstrapper-setup-${escapedVersion}-([a-z0-9_-]+)\\.exe(?:\\.blockmap)?$`, 'iu').exec(fileName)
    if (setupMatch) {
        const arch = setupMatch[1].toLowerCase()
        return await versionedPublishPath(filePath, version, `win32-${arch}`, 'setup')
    }

    return fileName
}

const VERSIONED_ARTIFACT_RE = /^pulsesync-app-(.+)-([a-z0-9_-]+)\.([a-z0-9]+(?:\.[a-z0-9]+)?)$/iu

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

function parseVersionedArtifactDescriptor(key: string): VersionedArtifactDescriptor | null {
    const fileName = path.basename(key)
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

function collectArtifactFamilies(filePaths: string[]): Set<string> {
    const families = new Set<string>()
    for (const filePath of filePaths) {
        const descriptor = parseVersionedArtifactDescriptor(filePath)
        if (!descriptor) continue
        families.add(descriptor.family)
    }
    return families
}

function compareVersionsDesc(left: string, right: string): number {
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
    currentVersion: string,
    keepRecentVersions: number,
    artifactFamilies: Set<string>,
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
            if (!descriptor || !artifactFamilies.has(descriptor.family)) continue

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
        if (!versionToKeys.has(currentVersion)) {
            versionToKeys.set(currentVersion, [])
        }

        const sortedVersions = Array.from(versionToKeys.keys()).sort(compareVersionsDesc)
        const keptVersions = new Set(sortedVersions.slice(0, keepRecentVersions))
        keptVersions.add(currentVersion)

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
        const familyList = Array.from(artifactFamilies).sort().join(', ')
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

    log(
        LogLevel.SUCCESS,
        `Retention removed ${keysToDelete.length} artifacts from ${branchPrefix} (${removedGroups.join(' | ')})`,
    )
}

async function uploadFileToS3(client: S3Client, bucket: string, key: string, filePath: string, headers?: UploadHeaders): Promise<void> {
    const { size } = await fs.promises.stat(filePath)
    const { threshold, partSize, concurrency } = getMultipartUploadConfig()
    const defaultUploadHeaders = isDesktopReleaseManifestFile(filePath)
        ? {
              CacheControl: 'no-store, no-cache, must-revalidate, max-age=0',
              ContentType: 'application/json; charset=utf-8',
          }
        : key.includes('/versions/')
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

                log(
                    LogLevel.INFO,
                    `Uploaded part ${partNumber}/${partCount} for ${key} (${Math.round((uploadedBytes / size) * 100)}%)`,
                )
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
    opts?: { prefix?: string; keepRecentVersions?: number | null },
): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }
    const prefix = (opts?.prefix || 'builds/app').replace(/^\/+|\/+$/g, '')
    const keepRecentVersions = opts?.keepRecentVersions ?? parseKeepRecentVersions(process.env.S3_KEEP_RECENT_VERSIONS)
    const client = createS3Client()

    let files = walkFiles(dir)
        .filter(fp => path.basename(fp) !== 'builder-debug.yml')
        .filter(fp => !isLegacyUpdaterArtifact(fp))
        .filter(fp => (version ? path.basename(fp).includes(version) || isDesktopReleaseManifestFile(fp) : true))
    const artifactFamilies = collectArtifactFamilies(files)

    const zipFiles = fs
        .readdirSync(dir)
        .filter(name => name.endsWith('.zip') && (!version || name.includes(version)))
        .map(name => path.join(dir, name))
    for (const zipPath of zipFiles) if (!files.includes(zipPath)) files.push(zipPath)

    files = [
        ...files.filter(filePath => !isDesktopReleaseManifestFile(filePath)),
        ...files.filter(filePath => isDesktopReleaseManifestFile(filePath)),
    ]

    if (version && keepRecentVersions && artifactFamilies.size) {
        await pruneOldArtifacts(client, bucket, prefix, branch, version, keepRecentVersions, artifactFamilies)
    }

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/${prefix}/${branch}/`)

    for (const filePath of files) {
        const key = `${prefix}/${branch}/${await resolveStructuredPublishPath(filePath, version)}`
        await uploadFileToS3(client, bucket, key, filePath)
    }

    log(LogLevel.SUCCESS, 'Publish to S3 completed')
}

export async function publishDirectoryToS3(dir: string, opts?: { prefix?: string }): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }

    const rootDir = path.resolve(dir)
    if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
        throw new Error(`Publish directory does not exist: ${rootDir}`)
    }

    const prefix = (opts?.prefix || process.env.S3_PREFIX || 'app').replace(/^\/+|\/+$/g, '')
    const client = createS3Client()
    const files = walkFiles(rootDir)

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/${prefix}/`)

    for (const filePath of files) {
        const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/')
        const key = `${prefix}/${relativePath}`
        await uploadFileToS3(client, bucket, key, filePath, getRemoteRendererUploadHeaders(relativePath, filePath))
    }

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
        log(
            LogLevel.ERROR,
            'Usage: tsx scripts/s3-upload.ts --branch <name> [--dir release] [--version x.y.z] [--prefix builds/app]',
        )
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
