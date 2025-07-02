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
import { S3Client, S3ClientConfig, PutObjectCommand } from '@aws-sdk/client-s3'

const exec = promisify(_exec)

const debug = process.argv.includes('--debug') || process.argv.includes('-d')
const buildInstaller = process.argv.includes('--installer') || process.argv.includes('-i')

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

    const latestPath = path.join(dir, 'latest.yml')
    const hasLatest = fs.existsSync(latestPath)

    if (hasLatest) {
        const raw = fs.readFileSync(latestPath, 'utf-8')
        const data = yaml.load(raw) as any
        data.commonConfig = {
            DEPRECATED_VERSIONS: process.env.DEPRECATED_VERSIONS,
            UPDATE_URL: `${process.env.S3_URL}/builds/${branch}/`,
        }
        fs.writeFileSync(latestPath, yaml.dump(data), 'utf-8')
        files.push(latestPath)
    }

    log(LogLevel.INFO, `Publishing ${files.length} files to s3://${bucket}/builds/${branch}/`)

    for (const filePath of files) {
        const key = `builds/${branch}/${path.relative(dir, filePath).replace(/\\/g, '/')}`
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

async function main(): Promise<void> {
    log(LogLevel.INFO, `Platform: ${os.platform()}, Arch: ${os.arch()}`)
    log(LogLevel.INFO, `CWD: ${process.cwd()}`)
    log(LogLevel.INFO, `Debug: ${debug ? 'ON' : 'OFF'}`)
    log(LogLevel.INFO, `Installer only: ${buildInstaller ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Publish branch: ${publishBranch ?? 'none'}`)

    if (publishBranch) {
        const appUpdateConfig = {
            provider: 'generic',
            url: `${process.env.S3_URL}/builds/${publishBranch}/`,
            channel: 'latest',
            updaterCacheDirName: 'pulsesyncapp-updater',
            useMultipleRangeRequest: true,
        }
        const rootAppUpdatePath = path.resolve(__dirname, '../app-update.yml')
        fs.writeFileSync(rootAppUpdatePath, yaml.dump(appUpdateConfig), 'utf-8')
        log(LogLevel.SUCCESS, `Generated ${rootAppUpdatePath}`)
    }

    const outDir = path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)
    const releaseDir = path.join('.', 'release')

    if (buildInstaller && !publishBranch) {
        await runCommandStep('Build (electron-builder)', `electron-builder --pd "${outDir}"`)
        log(LogLevel.SUCCESS, 'Done')
        return
    }

    const { version } = generateBuildInfo()

    await runCommandStep('Package (electron-forge)', 'electron-forge package')

    if (os.platform() === 'win32') {
        const src = path.resolve(__dirname, '../nativeModule/checkAccess/build/Release/checkAccessAddon.node')
        const dest = path.join(outDir, 'modules', 'checkAccess', 'checkAccessAddon.node')
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
        log(LogLevel.SUCCESS, `Copied native module to ${dest}`)
    }

    const builderBase = path.resolve(__dirname, '../electron-builder.yml')
    const baseYml = fs.readFileSync(builderBase, 'utf-8')
    const config = yaml.load(baseYml) as any

    if (publishBranch) {
        config.publish = [
            {
                provider: 'generic',
                url: `${process.env.S3_URL}/builds/${publishBranch}/`,
                channel: 'latest',
                updaterCacheDirName: 'pulsesyncapp-updater',
                useMultipleRangeRequest: true,
            },
        ]
        config.extraMetadata = config.extraMetadata || {}
        config.extraMetadata.branch = publishBranch
        config.extraMetadata.version = version
    }

    const tmpName = `builder-override-${crypto.randomBytes(4).toString('hex')}.yml`
    const tmpPath = path.join(os.tmpdir(), tmpName)
    fs.writeFileSync(tmpPath, yaml.dump(config), 'utf-8')

    const buildCmd = `electron-builder --pd "${outDir}" --config "${tmpPath}" --publish never`
    await runCommandStep('Build (electron-builder)', buildCmd)
    fs.unlinkSync(tmpPath)

    if (publishBranch) {
        await publishToS3(publishBranch, releaseDir, version)
    }

    log(LogLevel.SUCCESS, 'All steps completed successfully')
}

main().catch(err => {
    log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
    process.exit(1)
})
