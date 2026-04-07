import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import yaml from 'js-yaml'
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
import https from 'https'
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

async function hashFileSha512(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha512')
        const stream = fs.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
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

function isDmg(name: string) {
    return name.toLowerCase().endsWith('.dmg')
}
function isZip(name: string) {
    return name.toLowerCase().endsWith('.zip')
}
function fileTypeOf(name: string): 'dmg' | 'zip' {
    return isZip(name) ? 'zip' : 'dmg'
}

function parseMacArtifactArch(name: string): 'arm64' | 'x64' | null {
    const lower = name.toLowerCase()
    if (lower.includes('arm64')) return 'arm64'
    if (lower.includes('x64') || lower.includes('intel')) return 'x64'
    if (lower.includes('-mac') || lower.includes('mac')) return null
    if (lower.includes('universal')) return null
    return null
}

function collectMacArtifacts(releaseDir: string, version: string) {
    const files = fs.readdirSync(releaseDir).filter(n => (!version || n.includes(version)) && (isDmg(n) || isZip(n)))
    const out: Array<{ arch: 'arm64' | 'x64'; file: string; type: 'dmg' | 'zip' }> = []
    for (const n of files) {
        const arch = parseMacArtifactArch(n)
        if (!arch) continue
        out.push({ arch, file: path.join(releaseDir, n), type: fileTypeOf(n) })
    }
    const uniq = new Map<string, { arch: 'arm64' | 'x64'; file: string; type: 'dmg' | 'zip' }>()
    for (const a of out) {
        const key = `${a.arch}:${a.type}`
        if (!uniq.has(key)) uniq.set(key, a)
    }
    return Array.from(uniq.values())
}

async function collectRemoteMacArtifacts(
    client: S3Client,
    bucket: string,
    prefix: string,
    branch: string,
    version: string,
    baseUrl: string,
) {
    const branchPrefix = `${prefix}/${branch}/`
    const normalizedBaseUrl = baseUrl.replace(/\/+$/u, '')
    const uniq = new Map<string, { arch: 'arm64' | 'x64'; fileName: string; url: string; type: 'dmg' | 'zip' }>()
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

            const fileName = path.basename(object.Key)
            if ((version && !fileName.includes(version)) || (!isDmg(fileName) && !isZip(fileName))) {
                continue
            }

            const arch = parseMacArtifactArch(fileName)
            if (!arch) continue

            const type = fileTypeOf(fileName)
            const key = `${arch}:${type}`
            if (uniq.has(key)) continue

            uniq.set(key, {
                arch,
                fileName,
                url: `${normalizedBaseUrl}/${object.Key}`,
                type,
            })
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return Array.from(uniq.values())
}

async function fetchJson(url: string): Promise<any | null> {
    return await new Promise(resolve => {
        https
            .get(url, res => {
                if (res.statusCode && res.statusCode >= 400) {
                    res.resume()
                    resolve(null)
                    return
                }
                const chunks: Buffer[] = []
                res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
                res.on('end', () => {
                    try {
                        const raw = Buffer.concat(chunks).toString('utf-8')
                        resolve(JSON.parse(raw))
                    } catch {
                        resolve(null)
                    }
                })
            })
            .on('error', () => resolve(null))
    })
}

function walkFiles(dir: string): string[] {
    return fs.readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name)
        return fs.statSync(full).isDirectory() ? walkFiles(full) : [full]
    })
}

function isUpdaterManifestFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase()
    return fileName === 'latest.yml' || fileName === 'latest-linux.yml'
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

async function uploadFileToS3(client: S3Client, bucket: string, key: string, filePath: string): Promise<void> {
    const { size } = await fs.promises.stat(filePath)
    const { threshold, partSize, concurrency } = getMultipartUploadConfig()

    if (size < threshold) {
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: fs.createReadStream(filePath),
                ACL: 'public-read',
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
        .filter(fp => (version ? path.basename(fp).includes(version) || /latest(-linux)?\.yml$/.test(path.basename(fp)) : true))
    const artifactFamilies = collectArtifactFamilies(files)

    const platform = os.platform()
    let variantFile: string | null = 'latest.yml'
    if (platform === 'darwin') variantFile = null
    else if (platform === 'linux') variantFile = 'latest-linux.yml'

    if (variantFile) {
        const variantPath = path.join(dir, variantFile)
        if (fs.existsSync(variantPath)) {
            log(LogLevel.INFO, `Processing ${variantFile}`)
            const raw = fs.readFileSync(variantPath, 'utf-8')
            let data: any = {}
            try {
                data = yaml.load(raw) as any
            } catch (e: any) {
                log(LogLevel.ERROR, `Failed to parse ${variantFile}: ${e.message || e}`)
            }
            data.updateUrgency = 'soft'
            data.commonConfig = {
                DEPRECATED_VERSIONS: process.env.DEPRECATED_VERSIONS,
                UPDATE_URL: `${process.env.S3_URL}/${prefix}/${branch}/`,
            }
            fs.writeFileSync(variantPath, yaml.dump(data), 'utf-8')
            if (!files.includes(variantPath)) files.push(variantPath)
            log(LogLevel.SUCCESS, `Updated and queued ${variantFile}`)
        }
    }

    const zipFiles = fs
        .readdirSync(dir)
        .filter(name => name.endsWith('.zip') && (!version || name.includes(version)))
        .map(name => path.join(dir, name))
    for (const zipPath of zipFiles) if (!files.includes(zipPath)) files.push(zipPath)

    files = [
        ...files.filter(filePath => !isUpdaterManifestFile(filePath)),
        ...files.filter(filePath => isUpdaterManifestFile(filePath)),
    ]

    if (version && keepRecentVersions && artifactFamilies.size) {
        await pruneOldArtifacts(client, bucket, prefix, branch, version, keepRecentVersions, artifactFamilies)
    }

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/${prefix}/${branch}/`)

    for (const filePath of files) {
        const key = `${prefix}/${branch}/${path.relative(dir, filePath).replace(/\\/g, '/')}`
        await uploadFileToS3(client, bucket, key, filePath)
    }

    log(LogLevel.SUCCESS, 'Publish to S3 completed')
}

export async function generateAndPublishMacDownloadJson(
    branch: string,
    releaseDir: string,
    version: string,
    opts?: { prefix?: string },
): Promise<void> {
    if (os.platform() !== 'darwin') return
    const bucket = process.env.S3_BUCKET
    const baseUrl = process.env.S3_URL
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }
    if (!baseUrl) {
        log(LogLevel.ERROR, 'S3_URL is not set in env')
        process.exit(1)
    }
    const prefix = (opts?.prefix || 'builds/app').replace(/^\/+|\/+$/g, '')
    const localArtifacts = collectMacArtifacts(releaseDir, version)
    if (!localArtifacts.length) {
        log(LogLevel.ERROR, `No macOS artifacts found for version ${version} in ${releaseDir}`)
        process.exit(1)
    }
    const patchPath = path.resolve(__dirname, '../PATCHNOTES.md')
    let releaseNotes = ''
    if (fs.existsSync(patchPath)) {
        releaseNotes = fs.readFileSync(patchPath, 'utf-8')
    }
    const client = createS3Client()
    const assets: Array<{ arch: string; url: string; fileType: string; sha512: string }> = []
    for (const a of localArtifacts) {
        const sha512 = await hashFileSha512(a.file)
        const fileName = path.basename(a.file)
        assets.push({
            arch: a.arch,
            url: `${baseUrl}/${prefix}/${branch}/${fileName}`,
            fileType: a.type,
            sha512,
        })
    }
    const existingUrl = `${baseUrl}/${prefix}/${branch}/download.json`
    const existing = await fetchJson(existingUrl)
    const existingAssets = Array.isArray(existing?.assets) ? existing.assets : []
    const remoteAssets = await collectRemoteMacArtifacts(client, bucket, prefix, branch, version, baseUrl)
    const merged = new Map<string, { arch: string; url: string; fileType: string; sha512?: string }>()
    for (const a of existingAssets) {
        if (a?.arch && a?.fileType && a?.url) {
            merged.set(`${a.arch}:${a.fileType}`, a)
        }
    }
    for (const a of remoteAssets) {
        const key = `${a.arch}:${a.type}`
        const current = merged.get(key)
        merged.set(key, {
            arch: a.arch,
            url: a.url,
            fileType: a.type,
            sha512: current?.sha512,
        })
    }
    for (const a of assets) {
        merged.set(`${a.arch}:${a.fileType}`, a)
    }
    const mergedAssets = Array.from(merged.values())
    const preferred = mergedAssets.find(x => x.arch === 'x64') || mergedAssets.find(x => x.arch === 'arm64') || mergedAssets[0]
    const manifest = {
        version,
        url: preferred.url,
        fileType: preferred.fileType,
        sha512: preferred.sha512,
        releaseNotes: releaseNotes || existing?.releaseNotes || '',
        updateUrgency: 'soft',
        minOsVersion: '>=10.13',
        assets: mergedAssets,
    }
    const body = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
    const key = `${prefix}/${branch}/download.json`
    await client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ACL: 'public-read',
            ContentType: 'application/json',
        }),
    )
    log(LogLevel.SUCCESS, `Uploaded macOS download.json → s3://${bucket}/${key}`)
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
function hasFlag(flag: string): boolean {
    return process.argv.includes(flag)
}

async function cli(): Promise<void> {
    const branch = argValue('--branch') || argValue('-b')
    if (!branch) {
        log(
            LogLevel.ERROR,
            'Usage: tsx scripts/s3-upload.ts --branch <name> [--dir release] [--version x.y.z] [--prefix builds/app] [--mac-manifest]',
        )
        process.exit(1)
    }
    const dir = argValue('--dir') || 'release'
    const version = argValue('--version') || readPkgVersion()
    const prefix = argValue('--prefix') || process.env.S3_PREFIX || 'builds/app'
    const macManifest = hasFlag('--mac-manifest')
    const keepRecentVersions = parseKeepRecentVersions(argValue('--keep-last') || argValue('--keepLast') || process.env.S3_KEEP_RECENT_VERSIONS)

    log(LogLevel.INFO, `Branch: ${branch}`)
    log(LogLevel.INFO, `Dir: ${dir}`)
    log(LogLevel.INFO, `Version: ${version}`)
    log(LogLevel.INFO, `Prefix: ${prefix}`)
    log(LogLevel.INFO, `macOS download.json: ${macManifest ? 'ON' : 'OFF'}`)
    log(LogLevel.INFO, `Retention keep recent versions: ${keepRecentVersions ?? 'OFF'}`)

    await publishToS3(branch, dir, version, { prefix, keepRecentVersions })
    if (macManifest) {
        await generateAndPublishMacDownloadJson(branch, dir, version, { prefix })
    }
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
