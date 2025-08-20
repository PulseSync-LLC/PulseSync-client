import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { promisify } from 'util'
import { exec as _exec, execSync } from 'child_process'
import { performance } from 'perf_hooks'
import chalk from 'chalk'
import yaml from 'js-yaml'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const exec = promisify(_exec)

const debug = process.argv.includes('--debug') || process.argv.includes('-d')
const buildOnlyInstaller = process.argv.includes('--installer') || process.argv.includes('-i')
const buildApplication = process.argv.includes('--application') || process.argv.includes('-app')
const buildNativeModules = process.argv.includes('--nativeModules') || process.argv.includes('-n')
const sendPatchNotesFlag = process.argv.includes('--sendPatchNotes') || process.argv.includes('-sp')

const publishIndex = process.argv.findIndex(arg => arg === '--publish')
let publishBranch: string | null = null
if (publishIndex !== -1) {
    if (process.argv.length > publishIndex + 1) {
        const candidate = process.argv[publishIndex + 1]
        if (['beta', 'alpha', 'dev'].includes(candidate)) {
            publishBranch = candidate
        } else {
            console.error(chalk.red(`[ERROR] Invalid publish branch "${candidate}". Allowed: beta, alpha, dev.`))
            process.exit(1)
        }
    } else {
        console.error(chalk.red('[ERROR] No branch specified after --publish'))
        process.exit(1)
    }
}

enum LogLevel {
    INFO = 'INFO',
    SUCCESS = 'SUCCESS',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

function log(level: LogLevel, message: string): void {
    const ts = new Date().toISOString()
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

function generateBuildInfo(): { version: string } {
    const pkgPath = path.resolve(__dirname, '../package.json')
    log(LogLevel.INFO, `Reading package.json from ${pkgPath}`)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { version: string; buildInfo?: any; [key: string]: any }

    let branchHash = 'unknown'
    try {
        branchHash = execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim()
    } catch {
        log(LogLevel.WARN, 'Failed to get Git hash')
    }

    pkg.buildInfo = {
        VERSION: pkg.version,
        BRANCH: branchHash,
        BUILD_TIME: new Date().toISOString(),
    }

    let baseVersion = pkg.version.split('-')[0]
    let newVersion = baseVersion
    if (publishBranch) {
        newVersion = `${baseVersion}-${publishBranch}`
        pkg.version = newVersion
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4), 'utf-8')
    log(LogLevel.SUCCESS, `Updated package.json → version=${newVersion}, buildInfo.BRANCH=${branchHash}`)
    return { version: newVersion }
}

async function runCommandStep(name: string, command: string): Promise<void> {
    log(LogLevel.INFO, `Running step "${name}"…`)
    const start = performance.now()
    try {
        const { stdout, stderr } = await exec(command, { maxBuffer: 10 * 1024 * 1024 })
        const duration = ((performance.now() - start) / 1000).toFixed(2)
        if (debug) {
            if (stdout) process.stdout.write(stdout)
            if (stderr) process.stderr.write(stderr)
        }
        log(LogLevel.SUCCESS, `Step "${name}" completed in ${duration}s`)
    } catch (err: any) {
        const duration = ((performance.now() - start) / 1000).toFixed(2)
        log(LogLevel.ERROR, `Step "${name}" failed in ${duration}s`)
        log(LogLevel.ERROR, `Command: ${chalk.yellow(command)}`)
        if (err.stdout) process.stderr.write(chalk.yellow(err.stdout))
        if (err.stderr) process.stderr.write(chalk.yellow(err.stderr))
        process.exit(err.code ?? 1)
    }
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

async function publishToS3(branch: string, dir: string, version: string): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }

    const client = createS3Client()

    const walk = (p: string): string[] =>
        fs.readdirSync(p).flatMap(name => {
            const full = path.join(p, name)
            return fs.statSync(full).isDirectory() ? walk(full) : [full]
        })

    let files = walk(dir)
        .filter(fp => path.basename(fp) !== 'builder-debug.yml')
        .filter(fp => path.basename(fp).includes(version))

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
                UPDATE_URL: `${process.env.S3_URL}/builds/app/${branch}/`,
            }
            fs.writeFileSync(variantPath, yaml.dump(data), 'utf-8')
            files.push(variantPath)
            log(LogLevel.SUCCESS, `Updated and queued ${variantFile}`)
        }
    }

    const zipFiles = fs
        .readdirSync(dir)
        .filter(name => name.endsWith('.zip') && name.includes(version))
        .map(name => path.join(dir, name))

    for (const zipPath of zipFiles) {
        if (!files.includes(zipPath)) {
            files.push(zipPath)
            log(LogLevel.SUCCESS, `Queued ZIP installer: ${path.basename(zipPath)}`)
        }
    }

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/builds/app/${branch}/`)

    for (const filePath of files) {
        const key = `builds/app/${branch}/${path.relative(dir, filePath).replace(/\\/g, '/')}`
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
    const files = fs.readdirSync(releaseDir).filter(n => n.includes(version) && (isDmg(n) || isZip(n)))
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

async function generateAndPublishMacDownloadJson(branch: string, releaseDir: string, version: string): Promise<void> {
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
            url: `${baseUrl}/builds/app/${branch}/${fileName}`,
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
    const key = `builds/${branch}/download.json`
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

async function sendChangelogToApi(version: string): Promise<void> {
    const apiUrl = process.env.CDN_API_URL
    if (!apiUrl) {
        log(LogLevel.ERROR, 'CDN_API_URL is not set in env')
        process.exit(1)
    }
    const token = process.env.CDN_API_TOKEN
    if (!token) {
        log(LogLevel.ERROR, 'CDN_API_TOKEN is not set in env')
        process.exit(1)
    }
    const patchPath = path.resolve(__dirname, '../PATCHNOTES.md')
    if (!fs.existsSync(patchPath)) {
        log(LogLevel.WARN, `PATCHNOTES.md not found at ${patchPath}`)
        return
    }
    const rawPatch = fs.readFileSync(patchPath, 'utf-8')
    try {
        const res = await fetch(`${apiUrl}/cdn/app/changelog`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ version, rawPatch }),
        })
        if (!res.ok) {
            log(LogLevel.ERROR, `Failed to send changelog: ${res.status} ${res.statusText}`)
            process.exit(1)
        }
        log(LogLevel.SUCCESS, 'Changelog sent successfully')
    } catch (err: any) {
        log(LogLevel.ERROR, `Error sending changelog: ${err.message || err}`)
        process.exit(1)
    }
}

async function sendPatchNotes(): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK
    if (!webhookUrl) {
        log(LogLevel.ERROR, 'DISCORD_WEBHOOK is not set in env')
        process.exit(1)
    }
    const patchPath = path.resolve(__dirname, '../PATCHNOTES.md')
    if (!fs.existsSync(patchPath)) {
        log(LogLevel.WARN, `PATCHNOTES.md not found at ${patchPath}`)
        return
    }
    const rawPatch = fs.readFileSync(patchPath, 'utf-8')
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'))
    const version = pkg.version

    const embed = {
        title: 'PulseSync',
        description: 'Вышла новая версия приложения!',
        color: 0x5865f2,
        fields: [
            { name: 'Версия:', value: version, inline: true },
            { name: 'Изменения:', value: rawPatch, inline: true },
        ],
        footer: { text: 'https://pulsesync.dev', icon_url: process.env.BOT_AVATAR_URL },
        timestamp: new Date().toISOString(),
    }

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        })
        if (!res.ok) {
            log(LogLevel.ERROR, `Failed to send patchnotes: ${res.status} ${res.statusText}`)
            process.exit(1)
        }
        log(LogLevel.SUCCESS, 'Patchnotes sent successfully')
    } catch (err: any) {
        log(LogLevel.ERROR, `Error sending patchnotes: ${err.message || err}`)
        process.exit(1)
    }
}

function setConfigDevFalse() {
    const configPath = path.resolve(__dirname, '../src/renderer/api/config.ts')
    let content = fs.readFileSync(configPath, 'utf-8')
    content = content.replace(/export const isDev\s*=\s*.*$/m, 'export const isDev = false')
    content = content.replace(/export const isDevmark\s*=\s*.*$/m, 'export const isDevmark = false')
    fs.writeFileSync(configPath, content, 'utf-8')
    log(LogLevel.SUCCESS, `Set isDev and isDevmark to false in config.ts`)
}

function setConfigBranch(branch: string) {
    const configPath = path.resolve(__dirname, '../src/renderer/api/config.ts')
    let content = fs.readFileSync(configPath, 'utf-8')
    content = content.replace(/export const branch\s*=\s*.*$/m, `export const branch = ${branch}`)

    fs.writeFileSync(configPath, content, 'utf-8')
    log(LogLevel.SUCCESS, `Set branch=${branch} in config.ts`)
}

async function main(): Promise<void> {
    if (sendPatchNotesFlag && !buildApplication) {
        await sendPatchNotes()
        return
    }

    log(LogLevel.INFO, `Platform: ${os.platform()}, Arch: ${os.arch()}`)
    log(LogLevel.INFO, `CWD: ${process.cwd()}`)
    log(LogLevel.INFO, `Debug: ${debug ? 'ON' : 'OFF'}`)
    log(LogLevel.INFO, `Installer only: ${buildOnlyInstaller ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build native modules: ${buildNativeModules ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build application: ${buildApplication ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Publish branch: ${publishBranch ?? 'none'}`)

    const desiredLinuxExeName = 'pulsesync'
    const branchForConfig = publishBranch ?? 'beta'
    setConfigBranch(branchForConfig)

    if (buildNativeModules) {
        const nmDir = path.resolve(__dirname, '../nativeModules')
        log(LogLevel.INFO, `Building native modules in ${nmDir}`)
        const modules = fs.readdirSync(nmDir).filter(name => fs.statSync(path.join(nmDir, name)).isDirectory())
        for (const mod of modules) {
            const fullPath = path.join(nmDir, mod)
            await runCommandStep(`nativeModules:${mod}`, `cd "${fullPath}" && yarn build`)
        }
        log(LogLevel.SUCCESS, 'All native modules built successfully')
    }

    if (!buildNativeModules && buildOnlyInstaller && !publishBranch) {
        await runCommandStep(
            'Build (electron-builder)',
            `electron-builder --pd "${path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)}"`,
        )
        log(LogLevel.SUCCESS, 'Done')
        return
    }

    if (buildApplication) {
        if (publishBranch && publishBranch === 'beta' && os.platform() !== 'darwin') {
            setConfigDevFalse()
            const appUpdateConfig = {
                provider: 'generic',
                url: `${process.env.S3_URL}/builds/app/${publishBranch}/`,
                channel: 'latest',
                updaterCacheDirName: 'pulsesyncapp-updater',
                useMultipleRangeRequest: true,
            }
            const rootAppUpdatePath = path.resolve(__dirname, '../app-update.yml')
            fs.writeFileSync(rootAppUpdatePath, yaml.dump(appUpdateConfig), 'utf-8')
            log(LogLevel.SUCCESS, `Generated ${rootAppUpdatePath}`)
        } else if (publishBranch && publishBranch === 'beta' && os.platform() === 'darwin') {
            setConfigDevFalse()
        }

        const baseOutDir = path.join('.', 'out')
        const outDir = path.join(baseOutDir, `PulseSync-${os.platform()}-${os.arch()}`)
        const releaseDir = path.join('.', 'release')
        const { version } = generateBuildInfo()

        if (os.platform() === 'darwin') {
            await runCommandStep('Package (electron-forge:x64)', 'electron-forge package --arch x64')
            await runCommandStep('Package (electron-forge:arm64)', 'electron-forge package --arch arm64')
        } else {
            await runCommandStep('Package (electron-forge)', 'electron-forge package')
            const nativeDir = path.resolve(__dirname, '../nativeModules')

            function copyNodes(srcDir: string) {
                fs.readdirSync(srcDir, { withFileTypes: true }).forEach(entry => {
                    const fullPath = path.join(srcDir, entry.name)
                    if (entry.isDirectory()) {
                        copyNodes(fullPath)
                    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.node') {
                        const relativePath = path.relative(nativeDir, fullPath)
                        const dest = path.join(outDir, 'modules', relativePath)

                        fs.mkdirSync(path.dirname(dest), { recursive: true })
                        fs.copyFileSync(fullPath, dest)
                        log(LogLevel.SUCCESS, `Copied native module to ${dest}`)
                    }
                })
            }
            copyNodes(nativeDir)

            if (os.platform() === 'linux') {
                const builderBaseForName = path.resolve(__dirname, '../electron-builder.yml')
                let productNameFromYml = 'PulseSync'
                try {
                    const cfgRaw = fs.readFileSync(builderBaseForName, 'utf-8')
                    const cfg = yaml.load(cfgRaw) as any
                    if (cfg && typeof cfg.productName === 'string') productNameFromYml = cfg.productName
                } catch {}

                const currentBinUpper = path.join(outDir, productNameFromYml)
                const targetBinLower = path.join(outDir, desiredLinuxExeName)
                try {
                    if (fs.existsSync(currentBinUpper) && !fs.existsSync(targetBinLower)) {
                        fs.renameSync(currentBinUpper, targetBinLower)
                        log(LogLevel.SUCCESS, `Renamed Linux executable → ${desiredLinuxExeName}`)
                    }
                } catch (e: any) {
                    log(LogLevel.WARN, `Failed to rename executable: ${e.message || e}`)
                }
            }
        }

        const outDirX64 = path.join(baseOutDir, `PulseSync-${os.platform()}-x64`)
        const outDirARM64 = path.join(baseOutDir, `PulseSync-${os.platform()}-arm64`)

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any

        if (!configObj.linux) configObj.linux = {}
        configObj.linux.executableName = desiredLinuxExeName
        if (configObj.linux.desktop && configObj.linux.desktop.entry) {
            if (configObj.linux.desktop.entry.Icon) {
                configObj.linux.desktop.entry.Icon = desiredLinuxExeName
            }
        }

        if (publishBranch) {
            configObj.publish = [
                {
                    provider: 'generic',
                    url: `${process.env.S3_URL}/builds/app/${publishBranch}/`,
                    channel: 'latest',
                    updaterCacheDirName: 'pulsesyncapp-updater',
                    useMultipleRangeRequest: true,
                },
            ]
            configObj.extraMetadata = configObj.extraMetadata || {}
            configObj.extraMetadata.branch = publishBranch
            configObj.extraMetadata.version = version
        }

        const tmpName = `builder-override-${crypto.randomBytes(4).toString('hex')}.yml`
        const tmpPath = path.join(os.tmpdir(), tmpName)
        fs.writeFileSync(tmpPath, yaml.dump(configObj), 'utf-8')

        if (os.platform() === 'darwin') {
            await runCommandStep(
                'Build (electron-builder:x64)',
                `electron-builder --mac --x64 --pd "${outDirX64}" --config "${tmpPath}" --publish never`,
            )
            await runCommandStep(
                'Build (electron-builder:arm64)',
                `electron-builder --mac --arm64 --pd "${outDirARM64}" --config "${tmpPath}" --publish never`,
            )
        } else {
            await runCommandStep(
                'Build (electron-builder)',
                `electron-builder --pd "${path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)}" --config "${tmpPath}" --publish never`,
            )
        }

        fs.unlinkSync(tmpPath)

        if (publishBranch) {
            await publishToS3(publishBranch, releaseDir, version)
            if (os.platform() === 'darwin') {
                await generateAndPublishMacDownloadJson(publishBranch, releaseDir, version)
            }
            await sendChangelogToApi(version)
        }
        log(LogLevel.SUCCESS, 'All steps completed successfully')
    }
}

main().catch(err => {
    log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
    process.exit(1)
})
