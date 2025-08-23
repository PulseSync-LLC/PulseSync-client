import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import yaml from 'js-yaml'
import chalk from 'chalk'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

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

async function hashFileSha512(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash('sha512')
        const stream = fs.createReadStream(filePath)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(hash.digest('hex')))
    })
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

function walkFiles(dir: string): string[] {
    return fs.readdirSync(dir).flatMap(name => {
        const full = path.join(dir, name)
        return fs.statSync(full).isDirectory() ? walkFiles(full) : [full]
    })
}

export async function publishToS3(branch: string, dir: string, version?: string, opts?: { prefix?: string }): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }
    const prefix = (opts?.prefix || 'builds/app').replace(/^\/+|\/+$/g, '')
    const client = createS3Client()

    let files = walkFiles(dir)
        .filter(fp => path.basename(fp) !== 'builder-debug.yml')
        .filter(fp => (version ? path.basename(fp).includes(version) || /latest(-linux)?\.yml$/.test(path.basename(fp)) : true))

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

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/${prefix}/${branch}/`)

    for (const filePath of files) {
        const key = `${prefix}/${branch}/${path.relative(dir, filePath).replace(/\\/g, '/')}`
        const body = await fs.promises.readFile(filePath)
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ACL: 'public-read',
            }),
        )
        log(LogLevel.INFO, `Uploaded ${key}`)
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
    const artifacts = collectMacArtifacts(releaseDir, version)
    if (!artifacts.length) {
        log(LogLevel.ERROR, `No macOS artifacts found for version ${version} in ${releaseDir}`)
        process.exit(1)
    }
    const patchPath = path.resolve(__dirname, '../PATCHNOTES.md')
    let releaseNotes = ''
    if (fs.existsSync(patchPath)) {
        releaseNotes = fs.readFileSync(patchPath, 'utf-8')
    }
    const assets = []
    for (const a of artifacts) {
        const sha512 = await hashFileSha512(a.file)
        const fileName = path.basename(a.file)
        assets.push({
            arch: a.arch,
            url: `${baseUrl}/${prefix}/${branch}/${fileName}`,
            fileType: a.type,
            sha512,
        })
    }
    const preferred = assets.find(x => x.arch === 'x64') || assets.find(x => x.arch === 'arm64') || assets[0]
    const manifest = {
        version,
        url: preferred.url,
        fileType: preferred.fileType,
        sha512: preferred.sha512,
        releaseNotes,
        updateUrgency: 'soft',
        minOsVersion: '>=10.13',
        assets,
    }
    const body = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
    const client = createS3Client()
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
            'Usage: ts-node scripts/s3-upload.ts --branch <name> [--dir release] [--version x.y.z] [--prefix builds/app] [--mac-manifest]',
        )
        process.exit(1)
    }
    const dir = argValue('--dir') || 'release'
    const version = argValue('--version') || readPkgVersion()
    const prefix = argValue('--prefix') || process.env.S3_PREFIX || 'builds/app'
    const macManifest = hasFlag('--mac-manifest')

    log(LogLevel.INFO, `Branch: ${branch}`)
    log(LogLevel.INFO, `Dir: ${dir}`)
    log(LogLevel.INFO, `Version: ${version}`)
    log(LogLevel.INFO, `Prefix: ${prefix}`)
    log(LogLevel.INFO, `macOS download.json: ${macManifest ? 'ON' : 'OFF'}`)

    await publishToS3(branch, dir, version, { prefix })
    if (macManifest) {
        await generateAndPublishMacDownloadJson(branch, dir, version, { prefix })
    }
}

if (require.main === module) {
    cli().catch(err => {
        log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
        process.exit(1)
    })
}
