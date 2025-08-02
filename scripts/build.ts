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

async function publishToS3(branch: string, dir: string, version: string): Promise<void> {
    const bucket = process.env.S3_BUCKET
    if (!bucket) {
        log(LogLevel.ERROR, 'S3_BUCKET is not set in env')
        process.exit(1)
    }

    const client = new S3Client({
        region: process.env.S3_REGION,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: true,
        maxAttempts: Number(process.env.S3_MAX_ATTEMPTS) || 3,
    })

    const walk = (p: string): string[] =>
        fs.readdirSync(p).flatMap(name => {
            const full = path.join(p, name)
            return fs.statSync(full).isDirectory() ? walk(full) : [full]
        })

    let files = walk(dir)
        .filter(fp => path.basename(fp) !== 'builder-debug.yml')
        .filter(fp => path.basename(fp).includes(version))

    const platform = os.platform()
    let variantFile = 'latest.yml'
    if (platform === 'darwin') variantFile = 'latest-mac.yml'
    else if (platform === 'linux') variantFile = 'latest-linux.yml'

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
        if (publishBranch && publishBranch === 'beta') {
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
        }

        const outDirX64 = path.join(baseOutDir, `PulseSync-${os.platform()}-x64`)
        const outDirARM64 = path.join(baseOutDir, `PulseSync-${os.platform()}-arm64`)

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any

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
            await sendChangelogToApi(version)
        }
        log(LogLevel.SUCCESS, 'All steps completed successfully')
    }
}

main().catch(err => {
    log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
    process.exit(1)
})
