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
import { generateAndPublishMacDownloadJson, publishToS3 } from './s3-upload'
import { publishChangelogToApi, publishPatchNotesToDiscord } from './changelog-publish'

const exec = promisify(_exec)

const debug = process.argv.includes('--debug') || process.argv.includes('-d')
const buildOnlyInstaller = process.argv.includes('--installer') || process.argv.includes('-i')
const buildApplication = process.argv.includes('--application') || process.argv.includes('-app')
const buildNativeModules = process.argv.includes('--nativeModules') || process.argv.includes('-n')
const sendPatchNotesFlag = process.argv.includes('--sendPatchNotes') || process.argv.includes('-sp')
const publishChangelogFlag = process.argv.includes('--publish-changelog') || process.argv.includes('--publishChangelog')
const UPDATER_CACHE_DIR_NAME = 'pulsesync-updater'

const macX64Build = process.argv.includes('--mac-x64') || process.argv.includes('--mac-amd64') || process.argv.includes('-mx64')

const publishIndex = process.argv.findIndex(arg => arg === '--publish')
let publishBranch: string | null = null
let publishBranchTagSource: string | null = null
if (publishIndex !== -1) {
    if (process.argv.length > publishIndex + 1) {
        const candidate = process.argv[publishIndex + 1].trim().toLowerCase()
        if (/^[a-z0-9][a-z0-9-]*$/u.test(candidate)) {
            publishBranch = candidate
        } else {
            console.error(
                chalk.red(`[ERROR] Invalid publish branch "${candidate}". Use only letters, numbers, and dashes (e.g. beta, alpha, dev, tests).`),
            )
            process.exit(1)
        }
    } else {
        console.error(chalk.red('[ERROR] No branch specified after --publish'))
        process.exit(1)
    }
}

function parsePublishBranchFromTag(tagValue: string): string | null {
    const tag = tagValue.trim().replace(/^refs\/tags\//u, '').replace(/^v(?=\d)/u, '')
    if (!tag.includes('-')) {
        return null
    }

    const prereleasePart = tag.split('-').slice(1).join('-')
    if (!prereleasePart) {
        return null
    }

    const candidate = prereleasePart.split('.')[0]?.trim().toLowerCase()
    if (!candidate) {
        return null
    }
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(candidate)) {
        return null
    }
    return candidate
}

if (!publishBranch) {
    const tagSourceRaw = process.env.PUBLISH_BRANCH_FROM_TAG?.trim() || process.env.BUILD_VERSION?.trim()
    if (tagSourceRaw) {
        const parsedBranch = parsePublishBranchFromTag(tagSourceRaw)
        if (parsedBranch) {
            publishBranch = parsedBranch
            publishBranchTagSource = tagSourceRaw
        }
    }
}

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

function generateBuildInfo(): { version: string } {
    const pkgPath = path.resolve(__dirname, '../package.json')
    log(LogLevel.INFO, `Reading package.json from ${pkgPath}`)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { version: string; buildInfo?: any; [key: string]: any }

    const buildVersionRaw = process.env.BUILD_VERSION?.trim()
    if (buildVersionRaw) {
        const normalizedVersion = buildVersionRaw.replace(/^v(?=\d)/u, '')
        if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(normalizedVersion)) {
            log(LogLevel.ERROR, `Invalid BUILD_VERSION value: ${buildVersionRaw}`)
            process.exit(1)
        }
        pkg.version = normalizedVersion
        log(LogLevel.SUCCESS, `Overrode package version from BUILD_VERSION=${normalizedVersion}`)
    }

    let branchHash = 'unknown'
    try {
        branchHash = execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim()
    } catch {
        log(LogLevel.WARN, 'Failed to get Git hash')
    }

    const currentVersion = pkg.version
    let newVersion = currentVersion
    if (publishBranch) {
        const baseVersion = currentVersion.split('-')[0]
        newVersion = `${baseVersion}-${publishBranch}`
        pkg.version = newVersion
    }

    pkg.buildInfo = {
        VERSION: pkg.version,
        BRANCH: branchHash,
        BUILD_TIME: new Date().toLocaleString(),
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4), 'utf-8')
    log(LogLevel.SUCCESS, `Updated package.json → version=${newVersion}, buildInfo.BRANCH=${branchHash}`)
    return { version: newVersion }
}

function getProductNameFromConfig(): string {
    const builderBase = path.resolve(__dirname, '../electron-builder.yml')
    try {
        const cfgRaw = fs.readFileSync(builderBase, 'utf-8')
        const cfg = yaml.load(cfgRaw) as any
        if (cfg && typeof cfg.productName === 'string') {
            return cfg.productName
        }
    } catch {}
    return 'PulseSync'
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

function applyConfigFromEnv() {
    const configSource = process.env.APP_CONFIG
    if (configSource) {
        const appConfigPath = path.resolve(__dirname, '../src/common/appConfig.ts')
        fs.writeFileSync(appConfigPath, configSource, 'utf-8')
        log(LogLevel.SUCCESS, `Wrote ${appConfigPath}`)
    }
}

function ensureNodeHeapForMac(): void {
    if (os.platform() !== 'darwin') return
    const currentOptions = process.env.NODE_OPTIONS ?? ''
    if (/--max-old-space-size=\d+/u.test(currentOptions)) {
        return
    }
    const defaultHeapMb = 6144
    const nextOptions = `${currentOptions} --max-old-space-size=${defaultHeapMb}`.trim()
    process.env.NODE_OPTIONS = nextOptions
    log(LogLevel.WARN, `NODE_OPTIONS not set; defaulting to "${nextOptions}" to avoid macOS OOMs`)
}

function setConfigDevFalse(branch?: string) {
    const configPath = path.resolve(__dirname, '../src/common/appConfig.ts')
    let content = fs.readFileSync(configPath, 'utf-8')
    content = content.replace(/export const isDev\s*=\s*.*$/m, 'export const isDev = false')
    if (branch !== 'dev') {
        content = content.replace(/export const isDevmark\s*=\s*.*$/m, 'export const isDevmark = false')
    }
    fs.writeFileSync(configPath, content, 'utf-8')
    const devmarkStatus = branch === 'dev' ? ' (isDevmark kept for dev branch)' : ''
    log(LogLevel.SUCCESS, `Set isDev to false in appConfig.ts${devmarkStatus}`)
}

function setConfigBranch(branch: string) {
    const configPath = path.resolve(__dirname, '../src/common/appConfig.ts')
    let content = fs.readFileSync(configPath, 'utf-8')
    content = content.replace(/export const branch\s*=\s*.*$/m, `export const branch = "${branch}"`)

    fs.writeFileSync(configPath, content, 'utf-8')
    log(LogLevel.SUCCESS, `Set branch=${branch} in appConfig.ts`)
}

async function main(): Promise<void> {
    if (sendPatchNotesFlag && !buildApplication) {
        await publishPatchNotesToDiscord()
        return
    }
    ensureNodeHeapForMac()
    log(LogLevel.INFO, `APP_CONFIG length: ${process.env.APP_CONFIG?.length}`)
    applyConfigFromEnv()

    log(LogLevel.INFO, `Platform: ${os.platform()}, Arch: ${os.arch()}`)
    log(LogLevel.INFO, `CWD: ${process.cwd()}`)
    log(LogLevel.INFO, `Debug: ${debug ? 'ON' : 'OFF'}`)
    log(LogLevel.INFO, `Installer only: ${buildOnlyInstaller ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build native modules: ${buildNativeModules ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build application: ${buildApplication ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Publish branch: ${publishBranch ?? 'none'}`)
    if (publishBranch && publishBranchTagSource) {
        log(LogLevel.INFO, `Publish branch resolved from tag "${publishBranchTagSource}"`)
    }
    if (os.platform() === 'darwin') {
        log(LogLevel.INFO, `Mac target arch: ${macX64Build ? 'x64' : 'arm64'}`)
    }

    const branchForConfig = publishBranch ?? 'beta'
    setConfigBranch(branchForConfig)

    if (buildNativeModules) {
        const nmDir = path.resolve(__dirname, '../nativeModules')
        log(LogLevel.INFO, `Building native modules in ${nmDir}`)
        const modules = fs.readdirSync(nmDir).filter(name => fs.statSync(path.join(nmDir, name)).isDirectory())
        for (const mod of modules) {
            const fullPath = path.join(nmDir, mod)
            const packageJsonPath = path.join(fullPath, 'package.json')
            if (!fs.existsSync(packageJsonPath)) {
                log(LogLevel.WARN, `Skipping native module "${mod}" (package.json not found)`)
                continue
            }
            await runCommandStep(`nativeModules:${mod}`, `cd "${fullPath}" && yarn build`)
        }
        log(LogLevel.SUCCESS, 'All native modules built successfully')
    }

    if (!buildNativeModules && buildOnlyInstaller && !publishBranch) {
        const productName = getProductNameFromConfig()
        const pdPath =
            os.platform() === 'darwin'
                ? path.join('.', 'out', macX64Build ? 'PulseSync-darwin-x64' : 'PulseSync-darwin-arm64')
                : path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any

        if (os.platform() === 'darwin') {
            configObj.dmg = configObj.dmg || {}
            configObj.dmg.contents = [
                { x: 130, y: 220, type: 'file', path: path.resolve(pdPath, `${productName}.app`) },
                { x: 410, y: 220, type: 'link', path: '/Applications' },
            ]
        }
        const tmpName = `builder-override-${crypto.randomBytes(4).toString('hex')}.yml`
        const tmpPath = path.join(os.tmpdir(), tmpName)
        fs.writeFileSync(tmpPath, yaml.dump(configObj), 'utf-8')

        await runCommandStep('Build (electron-builder)', `electron-builder --pd "${pdPath}" --config "${tmpPath}"`)
        fs.unlinkSync(tmpPath)
        log(LogLevel.SUCCESS, 'Done')
        return
    }

    if (buildApplication) {
        if (publishBranch) {
            setConfigDevFalse(publishBranch)
            if (os.platform() !== 'darwin') {
                const appUpdateConfig = {
                    provider: 'generic',
                    url: `${process.env.S3_URL}/builds/app/${publishBranch}/`,
                    channel: 'latest',
                    updaterCacheDirName: UPDATER_CACHE_DIR_NAME,
                    useMultipleRangeRequest: true,
                }
                const rootAppUpdatePath = path.resolve(__dirname, '../app-update.yml')
                fs.writeFileSync(rootAppUpdatePath, yaml.dump(appUpdateConfig), 'utf-8')
                log(LogLevel.SUCCESS, `Generated ${rootAppUpdatePath}`)
            }
        }

        const baseOutDir = path.join('.', 'out')
        const outDir = path.join(baseOutDir, `PulseSync-${os.platform()}-${os.arch()}`)
        const releaseDir = path.join('.', 'release')
        const { version } = generateBuildInfo()

        if (os.platform() === 'darwin') {
            const targetArch = macX64Build ? 'x64' : 'arm64'
            await runCommandStep(`Package (electron-forge:${targetArch})`, `electron-forge package --arch ${targetArch}`)
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

        if (!configObj.linux) configObj.linux = {}
        configObj.linux.executableName = 'pulsesync'
        if (configObj.linux.desktop && configObj.linux.desktop.entry) {
            if (configObj.linux.desktop.entry.Icon) {
                configObj.linux.desktop.entry.Icon = 'pulsesync'
            }
        }

        if (publishBranch) {
            configObj.publish = [
                {
                    provider: 'generic',
                    url: `${process.env.S3_URL}/builds/app/${publishBranch}/`,
                    channel: 'latest',
                    updaterCacheDirName: UPDATER_CACHE_DIR_NAME,
                    useMultipleRangeRequest: true,
                },
            ]
            configObj.extraMetadata = configObj.extraMetadata || {}
            configObj.extraMetadata.branch = publishBranch
            configObj.extraMetadata.version = version
        }

        if (os.platform() === 'darwin') {
            const productName = getProductNameFromConfig()
            configObj.dmg = configObj.dmg || {}
            configObj.dmg.contents = [
                { x: 130, y: 220, type: 'file', path: path.resolve(outDir, `${productName}.app`) },
                { x: 410, y: 220, type: 'link', path: '/Applications' },
            ]
        }

        const tmpName = `builder-override-${crypto.randomBytes(4).toString('hex')}.yml`
        const tmpPath = path.join(os.tmpdir(), tmpName)
        fs.writeFileSync(tmpPath, yaml.dump(configObj), 'utf-8')

        if (os.platform() === 'darwin') {
            if (macX64Build) {
                await runCommandStep(
                    'Build (electron-builder:x64)',
                    `electron-builder --mac --x64 --pd "${outDirX64}" --config "${tmpPath}" --publish never`,
                )
            } else {
                await runCommandStep(
                    'Build (electron-builder:arm64)',
                    `electron-builder --mac --arm64 --pd "${outDirARM64}" --config "${tmpPath}" --publish never`,
                )
            }
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
            if (publishChangelogFlag) {
                await publishChangelogToApi(version)
            }
        }
        log(LogLevel.SUCCESS, 'All steps completed successfully')
    }
}

main().catch(err => {
    log(LogLevel.ERROR, `Unexpected error: ${err.message || err}`)
    process.exit(1)
})
