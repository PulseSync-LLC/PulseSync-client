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
import * as semver from 'semver'
import * as tar from 'tar'
import { fileURLToPath } from 'node:url'
import { publishToS3 } from './s3-upload.js'
import { publishChangelogToApi, publishPatchNotesToDiscord } from './changelog-publish.js'
import { assertGlitchTipSourceMapConfig, uploadGlitchTipSourceMaps } from './glitchtip-sourcemaps.js'
import { copyBootstrapperToInstallRoot } from './bootstrapper/build.js'
import { emitDesktopReleaseManifest } from './desktop-release-manifest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const exec = promisify(_exec)

const debug = process.argv.includes('--debug') || process.argv.includes('-d')
const buildOnlyInstaller = process.argv.includes('--installer') || process.argv.includes('-i')
const buildApplication = process.argv.includes('--application') || process.argv.includes('-app')
const buildNativeModules = process.argv.includes('--nativeModules') || process.argv.includes('-n')
const sendPatchNotesFlag = process.argv.includes('--sendPatchNotes') || process.argv.includes('-sp')
const publishChangelogFlag = process.argv.includes('--publish-changelog') || process.argv.includes('--publishChangelog')
const ELECTRON_LOCALES_TO_KEEP = new Set(['en-US.pak', 'ru.pak'])
const ARTIFACT_WORKER_FILE_NAME = 'artifactWorker.cjs'
const BOOTSTRAPPER_CONFIG_FILE_NAME = 'bootstrapper.json'
const BOOTSTRAPPER_RETAIN_APP_VERSIONS = 2
const DEFAULT_S3_URL = 'https://s3.pulsesync.dev'
const DEFAULT_SERVER_HEALTH_URL = 'https://ru-node-1.pulsesync.dev/api/v2/health'

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
    const tag = tagValue
        .trim()
        .replace(/^refs\/tags\//u, '')
        .replace(/^v(?=\d)/u, '')
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

function resolvePublishedVersion(currentVersion: string, targetBranch: string): string {
    const parsedVersion = semver.parse(currentVersion)
    if (!parsedVersion) {
        const baseVersion = currentVersion.split('-')[0]
        return `${baseVersion}-${targetBranch}`
    }

    const currentPrereleaseChannel = parsedVersion.prerelease[0]
    if (typeof currentPrereleaseChannel === 'string' && currentPrereleaseChannel.toLowerCase() === targetBranch.toLowerCase()) {
        return currentVersion
    }

    return `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}-${targetBranch}`
}

function normalizePemEnv(value: string): string {
    return value.replace(/\\n/g, '\n').trim()
}

function createBuildIdentityPayload(identity: { origin: string; version: string; commit: string; builtAt: string }): Buffer {
    return Buffer.from(`${identity.origin}\n${identity.version}\n${identity.commit}\n${identity.builtAt}`, 'utf8')
}

function signBuildIdentity(identity: { origin: string; version: string; commit: string; builtAt: string }): string {
    const privateKeyRaw = process.env.CLIENT_BUILD_IDENTITY_PRIVATE_KEY?.trim()
    if (!privateKeyRaw) {
        return ''
    }

    const privateKey = crypto.createPrivateKey(normalizePemEnv(privateKeyRaw))
    return crypto.sign(null, createBuildIdentityPayload(identity), privateKey).toString('base64')
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
        newVersion = resolvePublishedVersion(currentVersion, publishBranch)
        pkg.version = newVersion
    }

    const builtAt = new Date().toISOString()
    const buildIdentity = {
        origin: 'PulseSync-LLC/PulseSync-client',
        version: pkg.version,
        commit: branchHash,
        builtAt,
    }
    const signature = signBuildIdentity(buildIdentity)

    pkg.buildInfo = {
        VERSION: buildIdentity.version,
        BRANCH: buildIdentity.commit,
        BUILD_TIME: buildIdentity.builtAt,
        SIGNATURE_ALGORITHM: 'ed25519',
        SIGNATURE: signature,
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4), 'utf-8')
    log(
        LogLevel.SUCCESS,
        `Updated package.json → version=${newVersion}, buildInfo.BRANCH=${branchHash}, buildIdentity=${signature ? 'signed' : 'unsigned'}`,
    )
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

async function verifyBootstrapperBuildLayout(): Promise<void> {
    const tsxCli = path.join('node_modules', 'tsx', 'dist', 'cli.mjs')
    const args = os.platform() === 'darwin' && macX64Build ? ' --mac-x64' : ''
    await runCommandStep('Verify bootstrapper layout', `node "${tsxCli}" scripts/bootstrapper/verify-build-layout.ts${args}`)
}

function setBuildDist(platform: NodeJS.Platform, arch: string): string {
    const dist = `${platform}-${arch}`
    process.env.PULSESYNC_BUILD_DIST = dist
    log(LogLevel.INFO, `GlitchTip dist: ${dist}`)
    return dist
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

function hasCompiledNativeArtifact(modulePath: string): boolean {
    const releaseDir = path.join(modulePath, 'build', 'Release')
    if (!fs.existsSync(releaseDir)) {
        return false
    }

    return fs.readdirSync(releaseDir).some(fileName => path.extname(fileName).toLowerCase() === '.node')
}

function hasNativeModuleDependencies(modulePath: string): boolean {
    return fs.existsSync(path.join(modulePath, 'node_modules'))
}

async function createLinuxAurTarball(version: string, outDir: string, releaseDir: string): Promise<void> {
    const archiveName = `pulsesync-app-${version}-linux-x64.tar.gz`
    const archivePath = path.join(releaseDir, archiveName)
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsesync-aur-'))
    const appDir = path.join(stageRoot, 'opt', 'PulseSync')

    try {
        fs.mkdirSync(path.dirname(appDir), { recursive: true })
        fs.cpSync(outDir, appDir, { recursive: true })

        for (const executableName of ['pulsesync', 'chrome-sandbox', 'chrome_crashpad_handler']) {
            const executablePath = path.join(appDir, executableName)
            if (fs.existsSync(executablePath)) {
                fs.chmodSync(executablePath, 0o755)
            }
        }

        fs.mkdirSync(releaseDir, { recursive: true })
        await tar.create(
            {
                cwd: stageRoot,
                file: archivePath,
                gzip: true,
                portable: true,
            },
            ['opt'],
        )

        log(LogLevel.SUCCESS, `Created Linux AUR tarball: ${archivePath}`)
    } finally {
        fs.rmSync(stageRoot, { force: true, recursive: true })
    }
}

function shouldCreateLinuxAurTarball(publishBranch: string | null): boolean {
    return publishBranch !== 'dev'
}

function getBuildTargetArch(): string {
    return os.platform() === 'darwin' && macX64Build ? 'x64' : os.arch()
}

function getPackagedAppRoot(outDir: string): string {
    if (os.platform() !== 'darwin') return outDir

    return path.join(outDir, `${getProductNameFromConfig()}.app`, 'Contents')
}

function getBootstrapperInstallerRoot(outDir: string): string {
    return path.join(path.dirname(outDir), `${path.basename(outDir)}-bootstrapper`)
}

function getBootstrapperPayloadRoot(outDir: string): string {
    return getBootstrapperInstallerRoot(outDir)
}

function getBootstrapperSetupRoot(outDir: string): string {
    if (os.platform() !== 'win32') {
        return getPackagedAppRoot(outDir)
    }

    return path.join(path.dirname(outDir), `${path.basename(outDir)}-bootstrapper-setup`)
}

function getBootstrapperAppExecutableName(): string {
    const productName = getProductNameFromConfig()
    if (os.platform() === 'win32') {
        return `${productName}.exe`
    }
    if (os.platform() === 'darwin') {
        return path.join('MacOS', productName)
    }
    return 'pulsesync'
}

function appendCacheBuster(url: string, cacheKey: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}_=${encodeURIComponent(cacheKey)}`
}

function getBootstrapperManifestUrl(channel: string, dist: string, cacheKey: string): string {
    const explicitManifestUrl = process.env.PULSESYNC_BOOTSTRAPPER_MANIFEST_URL?.trim()
    if (explicitManifestUrl) {
        return appendCacheBuster(explicitManifestUrl, cacheKey)
    }

    const baseS3Url = (process.env.S3_URL?.trim() || DEFAULT_S3_URL).replace(/\/+$/u, '')
    return appendCacheBuster(`${baseS3Url}/builds/app/${channel}/desktop-update-${dist}.json`, cacheKey)
}

function getBootstrapperResourcesDir(installRoot: string): string {
    return os.platform() === 'darwin' ? path.join(installRoot, 'Resources') : path.join(installRoot, 'resources')
}

function writeBootstrapperSetupConfig(setupRoot: string, channel: string, dist: string, version: string): void {
    const config = {
        schemaVersion: 1,
        manifestUrl: getBootstrapperManifestUrl(channel, dist, version),
        serverHealthUrl: process.env.PULSESYNC_SERVER_HEALTH_URL?.trim() || DEFAULT_SERVER_HEALTH_URL,
        githubChannel: channel,
        dist,
        installedVersion: version,
        appExecutableName: getBootstrapperAppExecutableName(),
        retainAppVersions: BOOTSTRAPPER_RETAIN_APP_VERSIONS,
    }
    const configPath = path.join(getBootstrapperResourcesDir(setupRoot), BOOTSTRAPPER_CONFIG_FILE_NAME)
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`, 'utf-8')
}

function writeLinuxBootstrapperEntrypoint(setupRoot: string): void {
    if (os.platform() !== 'linux') {
        return
    }

    const launcherPath = path.join(setupRoot, 'pulsesync')
    const launcher = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'exec "${APP_DIR}/bootstrapper/pulsesync-bootstrapper" start --install-root "${APP_DIR}" -- "$@"',
        '',
    ].join('\n')

    fs.writeFileSync(launcherPath, launcher, 'utf-8')
    fs.chmodSync(launcherPath, 0o755)
}

function writeMacBootstrapperEntrypoint(setupRoot: string): void {
    if (os.platform() !== 'darwin') {
        return
    }

    const productName = getProductNameFromConfig()
    const launcherPath = path.join(setupRoot, 'MacOS', productName)
    const launcher = [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'APP_CONTENTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
        'exec "${APP_CONTENTS}/bootstrapper/pulsesync-bootstrapper" start --install-root "${APP_CONTENTS}" -- "$@"',
        '',
    ].join('\n')

    fs.mkdirSync(path.dirname(launcherPath), { recursive: true })
    fs.writeFileSync(launcherPath, launcher, 'utf-8')
    fs.chmodSync(launcherPath, 0o755)
}

function applyApplicationSetupArtifactName(configObj: any): void {
    if (os.platform() !== 'win32') {
        return
    }

    const artifactName = 'pulsesync-app-${version}-${arch}.${ext}'
    configObj.artifactName = artifactName
    configObj.nsis = configObj.nsis || {}
    configObj.nsis.artifactName = artifactName
}

function readPackageVersion(): string {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { version?: string }
    if (!pkg.version) {
        throw new Error(`Package version is missing: ${pkgPath}`)
    }
    return pkg.version
}

function isManagedReleaseArtifact(fileName: string): boolean {
    return (
        fileName === 'builder-debug.yml' ||
        fileName === 'download.json' ||
        fileName.startsWith('latest') ||
        fileName.endsWith('.blockmap') ||
        /^desktop-update-[a-z0-9_-]+\.json$/iu.test(fileName) ||
        /^pulsesync-app-/iu.test(fileName) ||
        /^pulsesync-app-payload-/iu.test(fileName) ||
        /^pulsesync-bootstrapper-/iu.test(fileName) ||
        /^pulsesync-module-/iu.test(fileName) ||
        /^pulsesync-native-modules-/iu.test(fileName)
    )
}

function cleanManagedReleaseArtifacts(releaseDir: string): void {
    if (!fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
        fs.mkdirSync(releaseDir, { recursive: true })
        return
    }

    for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
            continue
        }

        const fileName = entry.name.toLowerCase()
        if (isManagedReleaseArtifact(fileName)) {
            fs.rmSync(path.join(releaseDir, entry.name), { force: true })
        }
    }
}

function removeUnpublishedReleaseArtifacts(releaseDir: string): void {
    if (!fs.existsSync(releaseDir) || !fs.statSync(releaseDir).isDirectory()) {
        return
    }

    for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
            continue
        }

        const fileName = entry.name.toLowerCase()
        if (fileName === 'builder-debug.yml' || fileName === 'download.json' || fileName.startsWith('latest') || fileName.endsWith('.blockmap')) {
            fs.rmSync(path.join(releaseDir, entry.name), { force: true })
        }
    }
}

function copyDirectoryEntries(sourceDir: string, targetDir: string, excludedNames = new Set<string>()): void {
    fs.mkdirSync(targetDir, { recursive: true })
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (excludedNames.has(entry.name)) {
            continue
        }

        fs.cpSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), { recursive: true })
    }
}

async function prepareBootstrapperInstallerRoot(outDir: string): Promise<string> {
    const installRoot = getBootstrapperPayloadRoot(outDir)
    const packagedAppRoot = getPackagedAppRoot(outDir)

    const appPayloadDir = path.join(installRoot, 'app')
    fs.rmSync(installRoot, { force: true, recursive: true })
    copyDirectoryEntries(packagedAppRoot, appPayloadDir, new Set(['app', 'bootstrapper', 'modules', 'native', 'updates']))

    const sourceModulesDir = path.join(packagedAppRoot, 'modules')
    if (fs.existsSync(sourceModulesDir)) {
        fs.cpSync(sourceModulesDir, path.join(installRoot, 'modules'), { recursive: true })
    }

    fs.mkdirSync(path.join(installRoot, 'resources'), { recursive: true })
    await copyBootstrapperToInstallRoot(installRoot)
    return installRoot
}

async function prepareBootstrapperSetupRoot(outDir: string, channel: string, dist: string, version: string): Promise<string> {
    const setupRoot = getBootstrapperSetupRoot(outDir)
    fs.rmSync(setupRoot, { force: true, recursive: true })
    fs.mkdirSync(getBootstrapperResourcesDir(setupRoot), { recursive: true })
    const payloadRoot = getBootstrapperPayloadRoot(outDir)
    const versionedAppRoot = path.join(setupRoot, `app-${version}`)
    copyDirectoryEntries(path.join(payloadRoot, 'app'), versionedAppRoot)
    const modulesRoot = path.join(payloadRoot, 'modules')
    if (fs.existsSync(modulesRoot)) {
        fs.cpSync(modulesRoot, path.join(versionedAppRoot, 'modules'), { recursive: true })
    }
    await copyBootstrapperToInstallRoot(setupRoot)
    writeBootstrapperSetupConfig(setupRoot, channel, dist, version)
    fs.writeFileSync(
        path.join(setupRoot, 'current.json'),
        `${JSON.stringify({ schemaVersion: 1, version }, null, 4)}\n`,
        'utf-8',
    )
    writeLinuxBootstrapperEntrypoint(setupRoot)
    writeMacBootstrapperEntrypoint(setupRoot)
    return setupRoot
}

function getPackagedResourcesDir(outDir: string): string {
    return os.platform() === 'darwin' ? path.join(getPackagedAppRoot(outDir), 'Resources') : path.join(outDir, 'resources')
}

function getElectronLocalesDir(outDir: string): string {
    return os.platform() === 'darwin' ? path.join(getPackagedResourcesDir(outDir), 'locales') : path.join(outDir, 'locales')
}

function pruneElectronLocales(outDir: string): void {
    const localesDir = getElectronLocalesDir(outDir)
    if (!fs.existsSync(localesDir) || !fs.statSync(localesDir).isDirectory()) return

    let removed = 0
    for (const entry of fs.readdirSync(localesDir, { withFileTypes: true })) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pak') continue
        if (ELECTRON_LOCALES_TO_KEEP.has(entry.name)) continue

        fs.rmSync(path.join(localesDir, entry.name), { force: true })
        removed += 1
    }

    log(LogLevel.INFO, `Pruned ${removed} Electron locale packs from ${localesDir}`)
}

function copyRuntimeNativeModules(outDir: string): void {
    const nativeDir = path.resolve(__dirname, '../nativeModules')
    const modulesDir = path.join(getPackagedAppRoot(outDir), 'modules')

    fs.rmSync(modulesDir, { force: true, recursive: true })
    fs.rmSync(path.join(getPackagedAppRoot(outDir), 'native'), { force: true, recursive: true })

    for (const mod of fs.readdirSync(nativeDir)) {
        const modulePath = path.join(nativeDir, mod)
        if (!fs.existsSync(modulePath) || !fs.statSync(modulePath).isDirectory()) {
            continue
        }
        if (!fs.existsSync(path.join(modulePath, 'package.json'))) {
            continue
        }

        const releasePath = path.join(modulePath, 'build', 'Release')
        if (!fs.existsSync(releasePath) || !fs.statSync(releasePath).isDirectory()) {
            continue
        }

        const compiledArtifacts = fs
            .readdirSync(releasePath, { withFileTypes: true })
            .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.node')

        for (const artifact of compiledArtifacts) {
            const sourcePath = path.join(releasePath, artifact.name)
            const dest = path.join(modulesDir, mod, artifact.name)
            fs.mkdirSync(path.dirname(dest), { recursive: true })
            fs.copyFileSync(sourcePath, dest)
            log(LogLevel.SUCCESS, `Copied native module to ${dest}`)
        }
    }
}

function copyArtifactWorker(outDir: string): void {
    const source = path.resolve(__dirname, '..', '.vite', 'worker', ARTIFACT_WORKER_FILE_NAME)
    if (!fs.existsSync(source)) {
        throw new Error(`Artifact worker build output was not found: ${source}`)
    }

    const dest = path.join(getPackagedAppRoot(outDir), 'modules', 'artifactWorker', ARTIFACT_WORKER_FILE_NAME)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(source, dest)
    fs.rmSync(path.join(getPackagedResourcesDir(outDir), 'app.asar.unpacked', '.vite', 'worker'), { force: true, recursive: true })
    log(LogLevel.SUCCESS, `Copied artifact worker to ${dest}`)
}

async function main(): Promise<void> {
    if (sendPatchNotesFlag && !buildApplication) {
        await publishPatchNotesToDiscord()
        return
    }
    ensureNodeHeapForMac()
    if (buildApplication) {
        assertGlitchTipSourceMapConfig()
    }

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
        log(LogLevel.INFO, `Mac target arch: ${getBuildTargetArch()}`)
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
            if (hasNativeModuleDependencies(fullPath) && hasCompiledNativeArtifact(fullPath)) {
                log(LogLevel.SUCCESS, `Skipping native module "${mod}" (cached build artifacts found)`)
                continue
            }
            await runCommandStep(`nativeModules:${mod}`, `cd "${fullPath}" && yarn build`)
        }
        log(LogLevel.SUCCESS, 'All native modules built successfully')
    }

    if (!buildNativeModules && buildOnlyInstaller && !publishBranch) {
        const productName = getProductNameFromConfig()
        const targetArch = getBuildTargetArch()
        const releaseDir = path.join('.', 'release')
        cleanManagedReleaseArtifacts(releaseDir)
        const pdPath =
            os.platform() === 'darwin'
                ? path.join('.', 'out', macX64Build ? 'PulseSync-darwin-x64' : 'PulseSync-darwin-arm64')
                : path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)
        pruneElectronLocales(pdPath)
        fs.rmSync(path.join(getPackagedResourcesDir(pdPath), 'modules'), { force: true, recursive: true })
        copyRuntimeNativeModules(pdPath)
        copyArtifactWorker(pdPath)
        await prepareBootstrapperInstallerRoot(pdPath)
        const setupDist = setBuildDist(os.platform(), targetArch)
        const setupRoot = await prepareBootstrapperSetupRoot(pdPath, branchForConfig, setupDist, readPackageVersion())

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any
        applyApplicationSetupArtifactName(configObj)

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

        await runCommandStep('Build (electron-builder)', `electron-builder --pd "${setupRoot}" --config "${tmpPath}"`)
        removeUnpublishedReleaseArtifacts(releaseDir)
        fs.unlinkSync(tmpPath)
        log(LogLevel.SUCCESS, 'Done')
        return
    }

    if (buildApplication) {
        if (publishBranch) {
            setConfigDevFalse(publishBranch)
        }

        const baseOutDir = path.join('.', 'out')
        const targetArch = getBuildTargetArch()
        const outDir = path.join(baseOutDir, `PulseSync-${os.platform()}-${targetArch}`)
        const releaseDir = path.join('.', 'release')
        cleanManagedReleaseArtifacts(releaseDir)
        const { version } = generateBuildInfo()

        const buildDist =
            os.platform() === 'darwin'
                ? setBuildDist('darwin', targetArch)
                : setBuildDist(os.platform(), os.arch())

        if (os.platform() === 'darwin') {
            await runCommandStep(`Package (electron-forge:${targetArch})`, `electron-forge package --arch ${targetArch}`)
        } else {
            await runCommandStep('Package (electron-forge)', 'electron-forge package')
        }
        pruneElectronLocales(outDir)
        fs.rmSync(path.join(getPackagedResourcesDir(outDir), 'modules'), { force: true, recursive: true })
        copyRuntimeNativeModules(outDir)
        copyArtifactWorker(outDir)
        const payloadRoot = await prepareBootstrapperInstallerRoot(outDir)
        const setupRoot = await prepareBootstrapperSetupRoot(outDir, branchForConfig, buildDist, version)
        if (os.platform() === 'linux' && shouldCreateLinuxAurTarball(publishBranch)) {
            await createLinuxAurTarball(version, outDir, releaseDir)
        } else if (os.platform() === 'linux') {
            log(LogLevel.INFO, 'Skipping Linux AUR tarball for dev publish branch')
        }

        const outDirX64 = path.join(baseOutDir, `PulseSync-${os.platform()}-x64`)
        const outDirARM64 = path.join(baseOutDir, `PulseSync-${os.platform()}-arm64`)

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any
        applyApplicationSetupArtifactName(configObj)

        if (!configObj.linux) configObj.linux = {}
        configObj.linux.executableName = 'pulsesync'
        if (configObj.linux.desktop && configObj.linux.desktop.entry) {
            if (configObj.linux.desktop.entry.Icon) {
                configObj.linux.desktop.entry.Icon = 'pulsesync'
            }
        }

        if (publishBranch) {
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
                `electron-builder --pd "${setupRoot}" --config "${tmpPath}" --publish never`,
            )
        }
        removeUnpublishedReleaseArtifacts(releaseDir)

        fs.unlinkSync(tmpPath)

        await verifyBootstrapperBuildLayout()
        await uploadGlitchTipSourceMaps(version)

        if (publishBranch) {
            const baseS3Url = process.env.S3_URL?.trim()
            if (!baseS3Url) {
                throw new Error('S3_URL is required to generate desktop release manifest')
            }

            await emitDesktopReleaseManifest({
                baseUrl: `${baseS3Url.replace(/\/+$/u, '')}/builds/app/${publishBranch}`,
                channel: publishBranch,
                dist: buildDist,
                packagedAppRootDir: payloadRoot,
                releaseDir,
                rendererManifestUrl: process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL,
                version,
            })
            await publishToS3(publishBranch, releaseDir, version)
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
