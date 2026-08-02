import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { promisify } from 'util'
import { exec as _exec, execFileSync, execSync } from 'child_process'
import { performance } from 'perf_hooks'
import chalk from 'chalk'
import yaml from 'js-yaml'
import * as semver from 'semver'
import * as tar from 'tar'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import { publishToS3 } from './s3-upload.js'
import { publishChangelogToApi, publishPatchNotesToDiscord } from './changelog-publish.js'
import { assertGlitchTipSourceMapConfig, prepareDesktopCoreGlitchTipSourceMaps, uploadGlitchTipSourceMaps } from './glitchtip-sourcemaps.js'
import { buildUniversalMacBootstrapperExecutable, copyBootstrapperToInstallRoot } from './bootstrapper/build.js'
import { emitDesktopCoreUpdateManifest, emitDesktopReleaseManifest } from './desktop-release-manifest.js'
import { componentContainerName, readRuntimeComponentMetadata } from './component-layout.js'
import { emitLegacyUpdateBridge, isLegacyUpdateBridgeEnabled } from './legacy-update-bridge.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const exec = promisify(_exec)

const debug = process.argv.includes('--debug') || process.argv.includes('-d')
const buildOnlyInstaller = process.argv.includes('--installer') || process.argv.includes('-i')
const buildApplication = process.argv.includes('--application') || process.argv.includes('-app')
const buildDesktopCore = process.argv.includes('--core')
const buildNativeModules = process.argv.includes('--nativeModules') || process.argv.includes('-n')
const sendPatchNotesFlag = process.argv.includes('--sendPatchNotes') || process.argv.includes('-sp')
const publishChangelogFlag = process.argv.includes('--publish-changelog') || process.argv.includes('--publishChangelog')
const ELECTRON_LOCALES_TO_KEEP = new Set(['en-US.pak', 'ru.pak'])
const ARTIFACT_WORKER_FILE_NAME = 'artifactWorker.cjs'
const BOOTSTRAPPER_CONFIG_FILE_NAME = 'bootstrapper.json'
const BOOTSTRAPPER_RETAIN_APP_VERSIONS = 2
const DEFAULT_S3_URL = 'https://s3.pulsesync.dev'
const DEFAULT_SERVER_HEALTH_URL = 'https://ru-node-1.pulsesync.dev/api/v2/health'

function readBootstrapperVersion(): string {
    const cargoToml = fs.readFileSync(path.resolve(__dirname, '../packages/bootstrapper/Cargo.toml'), 'utf8')
    const version = /^version\s*=\s*"([^"]+)"/mu.exec(cargoToml)?.[1]
    if (!version) throw new Error('Bootstrapper package version is missing')
    return version
}

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

function generateBuildInfo(): { coreVersion: string; hostVersion: string; coreCommit: string } {
    const hostPackagePath = path.resolve(__dirname, '../package.json')
    const corePackagePath = path.resolve(__dirname, '../packages/desktop-core/package.json')
    log(LogLevel.INFO, `Reading desktop core package from ${corePackagePath}`)
    const raw = fs.readFileSync(corePackagePath, 'utf-8')
    const pkg = JSON.parse(raw) as { version: string; buildInfo?: any; [key: string]: any }
    const hostPackage = JSON.parse(fs.readFileSync(hostPackagePath, 'utf-8')) as { version: string }

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

    fs.writeFileSync(corePackagePath, JSON.stringify(pkg, null, 4), 'utf-8')
    log(
        LogLevel.SUCCESS,
        `Updated desktop core package → version=${newVersion}, hostVersion=${hostPackage.version}, buildInfo.BRANCH=${branchHash}, buildIdentity=${signature ? 'signed' : 'unsigned'}`,
    )
    return { coreVersion: newVersion, hostVersion: hostPackage.version, coreCommit: branchHash }
}

async function advanceDesktopCoreRevision(previousManifestUrl: string, dist: string): Promise<number> {
    const response = await fetch(previousManifestUrl, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
    if (!response.ok) throw new Error(`Cannot read published desktop manifest (${response.status}): ${previousManifestUrl}`)
    const manifest = (await response.json()) as {
        targets?: Record<string, { components?: { desktopCore?: { revision?: number } } }>
    }
    const previousRevision = manifest.targets?.[dist]?.components?.desktopCore?.revision
    if (!Number.isSafeInteger(previousRevision) || previousRevision === undefined || previousRevision <= 0) {
        throw new Error(`Published desktopCore revision is invalid for ${dist}`)
    }

    const packagePath = path.resolve(__dirname, '../packages/desktop-core/package.json')
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
        componentRevisions?: Record<string, number>
    }
    packageJson.componentRevisions = { ...packageJson.componentRevisions, desktopCore: previousRevision + 1 }
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 4)}\n`, 'utf8')
    return previousRevision + 1
}

async function buildDesktopCoreOnly(): Promise<void> {
    const dist = setBuildDist(os.platform(), getBuildTargetArch())
    const baseS3Url = (process.env.S3_URL?.trim() || DEFAULT_S3_URL).replace(/\/+$/u, '')
    const channel = publishBranch ?? 'local'
    const manifestName = os.platform() === 'darwin' ? `desktop-update-hybrid-${dist}.json` : `desktop-update-${dist}.json`
    const previousManifestUrl = `${baseS3Url}/builds/app/${channel}/${manifestName}?_=${Date.now()}`
    if (publishBranch) {
        const revision = await advanceDesktopCoreRevision(previousManifestUrl, dist)
        log(LogLevel.SUCCESS, `Advanced desktopCore revision to ${revision}`)
    }

    const { coreVersion, coreCommit } = generateBuildInfo()
    const outputRoot = path.resolve(__dirname, '../out/desktop-core')
    const viteOutputDir = path.join(outputRoot, 'vite')
    const component = readRuntimeComponentMetadata(path.resolve(__dirname, '..')).desktopCore
    const moduleDir = path.join(outputRoot, componentContainerName(component), component.diskName)
    const releaseDir = path.resolve(__dirname, '../release/desktop-core')
    fs.rmSync(outputRoot, { force: true, recursive: true })
    fs.rmSync(releaseDir, { force: true, recursive: true })

    await viteBuild({
        configFile: path.resolve(__dirname, '../vite.main.config.ts'),
        mode: 'production',
        build: {
            emptyOutDir: true,
            outDir: viteOutputDir,
            lib: {
                entry: path.resolve(__dirname, '../src/desktopCore.ts'),
                fileName: () => 'desktopCore.cjs',
                formats: ['cjs'],
            },
        },
    })
    await viteBuild({
        configFile: path.resolve(__dirname, '../vite.preload.config.ts'),
        mode: 'production',
        build: {
            emptyOutDir: false,
            outDir: viteOutputDir,
            rolldownOptions: {
                input: path.resolve(__dirname, '../src/main/mainWindowPreload.ts'),
                output: {
                    codeSplitting: false,
                    entryFileNames: 'mainWindowPreload.cjs',
                    chunkFileNames: '[name].cjs',
                    format: 'cjs',
                },
            },
        },
    })

    prepareDesktopCoreGlitchTipSourceMaps(viteOutputDir, dist)

    fs.mkdirSync(moduleDir, { recursive: true })
    fs.copyFileSync(path.join(viteOutputDir, 'desktopCore.cjs'), path.join(moduleDir, 'index.cjs'))
    fs.copyFileSync(path.join(viteOutputDir, 'mainWindowPreload.cjs'), path.join(moduleDir, 'mainWindowPreload.cjs'))
    fs.copyFileSync(path.resolve(__dirname, '../packages/desktop-core/package.json'), path.join(moduleDir, 'package.json'))
    log(LogLevel.SUCCESS, `Built desktopCore ${coreVersion} revision ${component.revision} without Electron packaging`)
    await uploadGlitchTipSourceMaps(coreVersion, coreCommit)

    if (!publishBranch) return
    const artifactBaseUrl = `${baseS3Url}/builds/app/${publishBranch}`
    const metadataVersion = process.env.DESKTOP_METADATA_VERSION?.trim() || String(Date.now())
    await emitDesktopCoreUpdateManifest({
        baseUrl: artifactBaseUrl,
        channel: publishBranch,
        coreModuleDir: moduleDir,
        coreVersion,
        dist,
        metadataVersion,
        previousManifestUrl,
        releaseDir,
        rendererManifestUrl: process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL,
    })
    await publishToS3(publishBranch, releaseDir, coreVersion, { keepRecentVersions: null })
    log(LogLevel.SUCCESS, `Published desktopCore ${coreVersion} revision ${component.revision}`)
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
    await runCommandStep('Verify bootstrapper layout', `node "${tsxCli}" scripts/bootstrapper/verify-build-layout.ts`)
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
    const keepDevmark = branch === 'alpha' || branch === 'dev'
    if (!keepDevmark) {
        content = content.replace(/export const isDevmark\s*=\s*.*$/m, 'export const isDevmark = false')
    }
    fs.writeFileSync(configPath, content, 'utf-8')
    const devmarkStatus = keepDevmark ? ` (isDevmark kept for ${branch} branch)` : ''
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
    return os.platform() === 'darwin' ? 'universal' : os.arch()
}

function assertMacUniversalBinary(binaryPath: string): void {
    if (os.platform() !== 'darwin') return
    execFileSync('/usr/bin/lipo', [binaryPath, '-verify_arch', 'x86_64', 'arm64'], {
        stdio: debug ? 'inherit' : 'pipe',
    })
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

function applyApplicationSetupArtifactName(configObj: any, desktopVersion: string): void {
    const artifactName = `pulsesync-app-${desktopVersion}-\${arch}.\${ext}`
    configObj.artifactName = artifactName
    if (os.platform() === 'win32') {
        configObj.nsis = configObj.nsis || {}
        configObj.nsis.artifactName = artifactName
    } else if (os.platform() === 'darwin') {
        configObj.dmg = configObj.dmg || {}
        configObj.dmg.artifactName = artifactName
    }
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
        /^pulsesync-host-/iu.test(fileName) ||
        /^pulsesync-host-bundle-/iu.test(fileName) ||
        /^pulsesync-bootstrapper-/iu.test(fileName) ||
        /^pulsesync-component-/iu.test(fileName) ||
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

    const hostPayloadDir = path.join(installRoot, 'host')
    fs.rmSync(installRoot, { force: true, recursive: true })
    copyDirectoryEntries(packagedAppRoot, hostPayloadDir, new Set(['app', 'bootstrapper', 'modules', 'native', 'updates']))

    const sourceModulesDir = path.join(packagedAppRoot, 'modules')
    if (fs.existsSync(sourceModulesDir)) {
        fs.cpSync(sourceModulesDir, path.join(installRoot, 'modules'), { recursive: true })
    }

    fs.mkdirSync(path.join(installRoot, 'resources'), { recursive: true })
    await copyBootstrapperToInstallRoot(installRoot)
    return installRoot
}

function resolveBundleVersion(): string {
    const raw = process.env.DESKTOP_METADATA_VERSION?.trim()
    if (!raw) {
        if (publishBranch) throw new Error('DESKTOP_METADATA_VERSION is required for a published desktop build')
        return '0'
    }
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('DESKTOP_METADATA_VERSION must be a positive integer')
    }
    return String(value)
}

function writeMacPackagedRuntime(outDir: string, desktopVersion: string, hostVersion: string, bundleVersion: string): string {
    const contentsRoot = getPackagedAppRoot(outDir)
    const modulesRoot = path.join(contentsRoot, 'modules')
    const components: Record<
        string,
        { version: string; path: string; sha256: string; required: boolean; revision?: number; diskName?: string; electronAbi?: string }
    > = {}
    const componentMetadata = readRuntimeComponentMetadata(path.resolve(__dirname, '..'))
    const electronAbi = fs.readFileSync(path.resolve(__dirname, '../node_modules/electron/abi_version'), 'utf8').trim()
    for (const component of Object.values(componentMetadata)) {
        const relativePath = path.join('modules', componentContainerName(component), component.diskName)
        components[component.name] = {
            version: component.version,
            path: relativePath.replace(/\\/gu, '/'),
            sha256: hashDirectory(path.join(contentsRoot, relativePath)),
            required: true,
            revision: component.revision,
            diskName: component.diskName,
            ...(component.name === 'pulsesyncNative' ? { electronAbi } : {}),
        }
    }
    if (components.desktopCore?.version !== desktopVersion) {
        throw new Error(`Expected packaged desktopCore ${desktopVersion}`)
    }
    const bootstrapperRelativePath = path.join('Resources', 'bootstrapper', 'pulsesync-bootstrapper')
    const bootstrapperPath = path.join(contentsRoot, bootstrapperRelativePath)
    components.bootstrapper = {
        version: readBootstrapperVersion(),
        path: bootstrapperRelativePath.replace(/\\/gu, '/'),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(bootstrapperPath)).digest('hex'),
        required: true,
    }
    const descriptor = {
        schemaVersion: 3,
        externalComponents: true,
        hostVersion,
        desktopVersion,
        bundleVersion,
        metadataVersion: Number(bundleVersion),
        hostElectronAbi: electronAbi,
        components,
    }
    const descriptorPath = path.join(contentsRoot, 'Resources', 'pulsesync-runtime.json')
    fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 4)}\n`, 'utf8')
    return descriptorPath
}

async function installMacBootstrapperSeed(outDir: string, desktopVersion: string, hostVersion: string, bundleVersion: string): Promise<string> {
    if (os.platform() !== 'darwin') {
        throw new Error('installMacBootstrapperSeed is only valid on macOS')
    }
    const executable = await buildUniversalMacBootstrapperExecutable()
    fs.rmSync(getBootstrapperInstallerRoot(outDir), { force: true, recursive: true })
    fs.rmSync(path.join(path.dirname(outDir), `${path.basename(outDir)}-bootstrapper-setup`), { force: true, recursive: true })
    const targetDir = path.join(getPackagedResourcesDir(outDir), 'bootstrapper')
    const targetExecutable = path.join(targetDir, 'pulsesync-bootstrapper')
    fs.rmSync(targetDir, { force: true, recursive: true })
    fs.mkdirSync(targetDir, { recursive: true })
    fs.copyFileSync(executable, targetExecutable)
    fs.chmodSync(targetExecutable, 0o755)
    assertMacUniversalBinary(targetExecutable)
    const infoPlist = path.join(outDir, `${getProductNameFromConfig()}.app`, 'Contents', 'Info.plist')
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${desktopVersion}`, infoPlist], {
        stdio: debug ? 'inherit' : 'pipe',
    })
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${bundleVersion}`, infoPlist], {
        stdio: debug ? 'inherit' : 'pipe',
    })
    writeMacPackagedRuntime(outDir, desktopVersion, hostVersion, bundleVersion)
    return targetDir
}

async function prepareBootstrapperSetupRoot(
    outDir: string,
    channel: string,
    dist: string,
    coreVersion: string,
    hostVersion: string,
    bundleVersion: string,
): Promise<string> {
    if (os.platform() === 'darwin') {
        throw new Error('macOS uses the intact Forge application bundle; setup-root transformation is forbidden')
    }
    const setupRoot = getBootstrapperSetupRoot(outDir)
    fs.rmSync(setupRoot, { force: true, recursive: true })
    fs.mkdirSync(getBootstrapperResourcesDir(setupRoot), { recursive: true })
    const payloadRoot = getBootstrapperPayloadRoot(outDir)
    const componentMetadata = readRuntimeComponentMetadata(path.resolve(__dirname, '..'))
    if (componentMetadata.desktopCore.version !== coreVersion) {
        throw new Error(`Expected desktop core ${coreVersion}, got ${componentMetadata.desktopCore.version}`)
    }
    const versionedHostRoot = path.join(setupRoot, `app-${hostVersion}`)
    copyDirectoryEntries(path.join(payloadRoot, 'host'), versionedHostRoot)
    const hostSha256 = hashDirectory(versionedHostRoot)
    const modulesRoot = path.join(payloadRoot, 'modules')
    if (fs.existsSync(modulesRoot)) {
        fs.cpSync(modulesRoot, path.join(versionedHostRoot, 'modules'), { recursive: true })
    }
    await copyBootstrapperToInstallRoot(setupRoot)
    writeBootstrapperSetupConfig(setupRoot, channel, dist, coreVersion)
    const desktopCore = componentMetadata.desktopCore
    const coreRelativePath = path.join(`app-${hostVersion}`, 'modules', componentContainerName(desktopCore), desktopCore.diskName)
    const coreDirectory = path.join(setupRoot, coreRelativePath)
    const coreEntryPath = path.join(coreDirectory, 'index.cjs')
    if (!fs.existsSync(coreEntryPath) || !fs.statSync(coreEntryPath).isFile()) {
        throw new Error(`Desktop core entry is missing from setup layout: ${coreEntryPath}`)
    }
    const electronAbi = fs.readFileSync(path.resolve(__dirname, '../node_modules/electron/abi_version'), 'utf8').trim()
    const components: Record<
        string,
        { version: string; path: string; sha256: string; required: boolean; revision?: number; diskName?: string; electronAbi?: string }
    > = {}
    for (const component of Object.values(componentMetadata)) {
        const relativePath = path.join(`app-${hostVersion}`, 'modules', componentContainerName(component), component.diskName)
        components[component.name] = {
            version: component.version,
            revision: component.revision,
            diskName: component.diskName,
            path: relativePath.replace(/\\/gu, '/'),
            sha256: hashDirectory(path.join(setupRoot, relativePath)),
            required: true,
            ...(component.name === 'pulsesyncNative' ? { electronAbi } : {}),
        }
    }
    const bootstrapperRelativePath = path.join('bootstrapper', os.platform() === 'win32' ? 'pulsesync-bootstrapper.exe' : 'pulsesync-bootstrapper')
    const bootstrapperPath = path.join(setupRoot, bootstrapperRelativePath)
    components.bootstrapper = {
        version: readBootstrapperVersion(),
        path: bootstrapperRelativePath.replace(/\\/gu, '/'),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(bootstrapperPath)).digest('hex'),
        required: true,
    }
    const initialSnapshot = {
        bundleVersion,
        metadataVersion: Number(bundleVersion),
        host: {
            version: hostVersion,
            path: `app-${hostVersion}`,
            sha256: hostSha256,
            electronAbi,
        },
        components,
    }
    const installState = {
        schemaVersion: 3,
        generation: 1,
        activation: { state: 'confirmed', generation: 1 },
        latest: initialSnapshot,
        running: initialSnapshot,
        lastSuccessful: initialSnapshot,
        knownGood: initialSnapshot,
        pinned: null,
    }
    const runtimeDir = path.join(setupRoot, 'runtime')
    fs.mkdirSync(runtimeDir, { recursive: true })
    fs.writeFileSync(path.join(runtimeDir, 'install-state.json'), `${JSON.stringify(installState, null, 4)}\n`, 'utf-8')
    fs.mkdirSync(path.join(setupRoot, 'updates', 'staging'), { recursive: true })
    fs.mkdirSync(path.join(setupRoot, 'updates', 'transactions'), { recursive: true })
    writeLinuxBootstrapperEntrypoint(setupRoot)
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

        fs.rmSync(path.join(modulesDir, mod), { force: true, recursive: true })
        for (const artifact of compiledArtifacts) {
            const sourcePath = path.join(releasePath, artifact.name)
            assertMacUniversalBinary(sourcePath)
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

function hashDirectory(directory: string): string {
    const hash = crypto.createHash('sha256')
    const files: Array<{ nativeRelative: string; normalizedRelative: string; path: string }> = []
    const visit = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name)
            if (entry.isDirectory()) {
                visit(entryPath)
                continue
            }
            const nativeRelative = path.relative(directory, entryPath)
            files.push({ nativeRelative, normalizedRelative: nativeRelative.replace(/\\/gu, '/'), path: entryPath })
        }
    }
    visit(directory)
    files.sort((left, right) => (left.nativeRelative < right.nativeRelative ? -1 : left.nativeRelative > right.nativeRelative ? 1 : 0))
    for (const file of files) {
        hash.update(file.normalizedRelative)
        hash.update('\0')
        hash.update(fs.readFileSync(file.path))
        hash.update('\0')
    }
    return hash.digest('hex')
}

type PublishedComponentRevision = {
    contentSha256?: string
    diskName?: string
    revision?: number
    version?: string
}

type PublishedRevisionManifest = {
    targets?: Record<
        string,
        {
            host?: { version?: string }
            components?: Record<string, PublishedComponentRevision>
        }
    >
}

function findPackagedComponentModule(
    modulesDir: string,
    component: ReturnType<typeof readRuntimeComponentMetadata>[string],
): { container: string; module: string } {
    const expectedContainer = path.join(modulesDir, componentContainerName(component))
    const expectedModule = path.join(expectedContainer, component.diskName)
    if (fs.existsSync(expectedModule) && fs.statSync(expectedModule).isDirectory()) {
        return { container: expectedContainer, module: expectedModule }
    }

    const sourceEntry = fs
        .readdirSync(modulesDir, { withFileTypes: true })
        .find(
            entry =>
                entry.isDirectory() &&
                (entry.name === component.name || entry.name.startsWith(`${component.name}-`) || entry.name.startsWith(`${component.diskName}-`)),
        )
    if (!sourceEntry) throw new Error(`Packaged component is missing: ${component.name}`)

    const container = path.join(modulesDir, sourceEntry.name)
    const nestedModule = [path.join(container, component.diskName), path.join(container, component.name)].find(
        candidate => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
    )
    return { container, module: nestedModule ?? container }
}

async function readPublishedRevisionManifest(url: string): Promise<PublishedRevisionManifest | null> {
    const separator = url.includes('?') ? '&' : '?'
    const response = await fetch(`${url}${separator}_=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
    })
    if (response.status === 403 || response.status === 404) return null
    if (!response.ok) throw new Error(`Cannot read published desktop manifest (${response.status}): ${url}`)
    return (await response.json()) as PublishedRevisionManifest
}

async function resolvePublishedComponentRevisions(outDir: string, manifestUrl: string, dist: string, hostVersion: string): Promise<void> {
    if (process.env.PULSESYNC_AUTO_COMPONENT_REVISIONS?.trim() !== '1') return

    const modulesDir = path.join(getPackagedAppRoot(outDir), 'modules')
    const components = readRuntimeComponentMetadata(path.resolve(__dirname, '..'))
    const previousManifest = await readPublishedRevisionManifest(manifestUrl)
    const previousTarget = previousManifest?.targets?.[dist]
    const hostChanged = previousTarget?.host?.version !== hostVersion
    const revisions: Record<string, number> = {}

    for (const component of Object.values(components)) {
        const source = findPackagedComponentModule(modulesDir, component)
        const contentSha256 = hashDirectory(source.module)
        const previous = previousTarget?.components?.[component.name]

        if (!previous) {
            revisions[component.name] = 1
        } else {
            const previousRevision = previous.revision
            if (!Number.isSafeInteger(previousRevision) || previousRevision === undefined || previousRevision <= 0) {
                throw new Error(`Published component revision is invalid for ${component.name} in ${dist}`)
            }
            const contentChanged =
                previous.version !== component.version || previous.diskName !== component.diskName || previous.contentSha256 !== contentSha256
            revisions[component.name] = hostChanged || contentChanged ? previousRevision + 1 : previousRevision
        }

        log(
            LogLevel.INFO,
            `Resolved ${component.name} revision ${revisions[component.name]} (${hostChanged ? `new host ${hostVersion}` : 'current host'})`,
        )
    }

    process.env.PULSESYNC_COMPONENT_REVISIONS = JSON.stringify(revisions)
}

function normalizeVersionedRuntimeModules(outDir: string): void {
    const modulesDir = path.join(getPackagedAppRoot(outDir), 'modules')
    if (!fs.existsSync(modulesDir)) return
    const components = readRuntimeComponentMetadata(path.resolve(__dirname, '..'))
    for (const component of Object.values(components)) {
        const targetContainer = path.join(modulesDir, componentContainerName(component))
        const targetModule = path.join(targetContainer, component.diskName)
        if (fs.existsSync(targetModule)) continue

        const source = findPackagedComponentModule(modulesDir, component)
        const sourceContainer = source.container
        const sourceModule = source.module
        fs.mkdirSync(targetContainer, { recursive: true })
        if (sourceModule === sourceContainer) {
            const temporaryModule = path.join(modulesDir, `.${component.diskName}-staging`)
            fs.rmSync(temporaryModule, { force: true, recursive: true })
            fs.renameSync(sourceModule, temporaryModule)
            fs.renameSync(temporaryModule, targetModule)
        } else {
            fs.renameSync(sourceModule, targetModule)
            fs.rmSync(sourceContainer, { force: true, recursive: true })
        }
    }

    const expectedContainers = new Set(Object.values(components).map(componentContainerName))
    for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !expectedContainers.has(entry.name)) {
            throw new Error(`Unexpected packaged module entry: ${entry.name}`)
        }
    }
}

async function main(): Promise<void> {
    if (sendPatchNotesFlag && !buildApplication) {
        await publishPatchNotesToDiscord()
        return
    }
    ensureNodeHeapForMac()
    if (buildApplication || buildDesktopCore) {
        assertGlitchTipSourceMapConfig()
    }

    log(LogLevel.INFO, `Platform: ${os.platform()}, Arch: ${os.arch()}`)
    log(LogLevel.INFO, `CWD: ${process.cwd()}`)
    log(LogLevel.INFO, `Debug: ${debug ? 'ON' : 'OFF'}`)
    log(LogLevel.INFO, `Installer only: ${buildOnlyInstaller ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build native modules: ${buildNativeModules ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build application: ${buildApplication ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Build desktop core only: ${buildDesktopCore ? 'YES' : 'NO'}`)
    log(LogLevel.INFO, `Publish branch: ${publishBranch ?? 'none'}`)
    if (publishBranch && publishBranchTagSource) {
        log(LogLevel.INFO, `Publish branch resolved from tag "${publishBranchTagSource}"`)
    }
    if (os.platform() === 'darwin') {
        log(LogLevel.INFO, `Mac target arch: ${getBuildTargetArch()}`)
    }

    const branchForConfig = publishBranch ?? 'beta'
    if (!buildDesktopCore || publishBranch) setConfigBranch(branchForConfig)

    if (buildDesktopCore) {
        await buildDesktopCoreOnly()
        return
    }

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
            if (os.platform() === 'darwin') {
                await runCommandStep(`nativeModules:${mod}:universal`, `cd "${fullPath}" && yarn build --universal`)
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
                ? path.join('.', 'out', 'PulseSync-darwin-universal')
                : path.join('.', 'out', `PulseSync-${os.platform()}-${os.arch()}`)
        pruneElectronLocales(pdPath)
        fs.rmSync(path.join(getPackagedResourcesDir(pdPath), 'modules'), { force: true, recursive: true })
        copyRuntimeNativeModules(pdPath)
        copyArtifactWorker(pdPath)
        normalizeVersionedRuntimeModules(pdPath)
        const setupDist = setBuildDist(os.platform(), targetArch)
        const coreVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../packages/desktop-core/package.json'), 'utf8')).version as string
        let setupRoot: string
        if (os.platform() === 'darwin') {
            await installMacBootstrapperSeed(pdPath, coreVersion, readPackageVersion(), resolveBundleVersion())
            setupRoot = pdPath
        } else {
            await prepareBootstrapperInstallerRoot(pdPath)
            setupRoot = await prepareBootstrapperSetupRoot(
                pdPath,
                branchForConfig,
                setupDist,
                coreVersion,
                readPackageVersion(),
                resolveBundleVersion(),
            )
        }

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any
        applyApplicationSetupArtifactName(configObj, coreVersion)

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
        const { coreVersion: version, hostVersion, coreCommit } = generateBuildInfo()

        const buildDist = os.platform() === 'darwin' ? setBuildDist('darwin', targetArch) : setBuildDist(os.platform(), os.arch())

        if (os.platform() === 'darwin') {
            await runCommandStep('Package (electron-forge:universal)', 'electron-forge package --arch universal')
        } else {
            await runCommandStep('Package (electron-forge)', 'electron-forge package')
        }
        pruneElectronLocales(outDir)
        if (os.platform() === 'darwin') {
            assertMacUniversalBinary(path.join(outDir, `${getProductNameFromConfig()}.app`, 'Contents', 'MacOS', getProductNameFromConfig()))
        }
        fs.rmSync(path.join(getPackagedResourcesDir(outDir), 'modules'), { force: true, recursive: true })
        copyRuntimeNativeModules(outDir)
        copyArtifactWorker(outDir)
        if (publishBranch) {
            const baseS3Url = process.env.S3_URL?.trim()
            if (!baseS3Url) throw new Error('S3_URL is required to resolve published component revisions')
            const manifestName = os.platform() === 'darwin' ? `desktop-update-hybrid-${buildDist}.json` : `desktop-update-${buildDist}.json`
            await resolvePublishedComponentRevisions(
                outDir,
                `${baseS3Url.replace(/\/+$/u, '')}/builds/app/${publishBranch}/${manifestName}`,
                buildDist,
                hostVersion,
            )
        }
        normalizeVersionedRuntimeModules(outDir)
        let payloadRoot: string
        let setupRoot: string
        if (os.platform() === 'darwin') {
            await installMacBootstrapperSeed(outDir, version, hostVersion, resolveBundleVersion())
            payloadRoot = outDir
            setupRoot = outDir
        } else {
            payloadRoot = await prepareBootstrapperInstallerRoot(outDir)
            setupRoot = await prepareBootstrapperSetupRoot(outDir, branchForConfig, buildDist, version, hostVersion, resolveBundleVersion())
        }
        if (os.platform() === 'linux' && shouldCreateLinuxAurTarball(publishBranch)) {
            await createLinuxAurTarball(version, outDir, releaseDir)
        } else if (os.platform() === 'linux') {
            log(LogLevel.INFO, 'Skipping Linux AUR tarball for dev publish branch')
        }

        const builderBase = path.resolve(__dirname, '../electron-builder.yml')
        const baseYml = fs.readFileSync(builderBase, 'utf-8')
        const configObj = yaml.load(baseYml) as any
        applyApplicationSetupArtifactName(configObj, version)

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
            configObj.extraMetadata.version = hostVersion
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
            await runCommandStep(
                'Build (electron-builder:universal)',
                `electron-builder --mac --universal --pd "${outDir}" --config "${tmpPath}" --publish never`,
            )
        } else {
            await runCommandStep('Build (electron-builder)', `electron-builder --pd "${setupRoot}" --config "${tmpPath}" --publish never`)
        }
        removeUnpublishedReleaseArtifacts(releaseDir)

        if (isLegacyUpdateBridgeEnabled(publishBranch, version)) {
            const baseS3Url = process.env.S3_URL?.trim()
            if (!baseS3Url || !publishBranch) throw new Error('S3_URL and publish branch are required for the legacy update bridge')
            const metadataPath = await emitLegacyUpdateBridge({
                baseUrl: `${baseS3Url.replace(/\/+$/u, '')}/builds/app/${publishBranch}`,
                platform: os.platform(),
                releaseDir,
                version,
            })
            if (metadataPath) log(LogLevel.SUCCESS, `Generated legacy update bridge: ${metadataPath}`)
        }

        fs.unlinkSync(tmpPath)

        await verifyBootstrapperBuildLayout()
        await uploadGlitchTipSourceMaps(version, coreCommit)

        if (publishBranch) {
            const baseS3Url = process.env.S3_URL?.trim()
            if (!baseS3Url) {
                throw new Error('S3_URL is required to generate desktop release manifest')
            }

            const desktopArtifactBaseUrl = `${baseS3Url.replace(/\/+$/u, '')}/builds/app/${publishBranch}`
            await emitDesktopReleaseManifest({
                baseUrl: desktopArtifactBaseUrl,
                channel: publishBranch,
                dist: buildDist,
                packagedAppRootDir: payloadRoot,
                releaseDir,
                rendererManifestUrl: process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL,
                coreVersion: version,
                hostVersion,
                metadataVersion: process.env.DESKTOP_METADATA_VERSION,
                previousManifestUrl: `${desktopArtifactBaseUrl}/desktop-update-${buildDist}.json`,
            })
            await publishToS3(publishBranch, releaseDir, version, { legacyUpdateBridge: isLegacyUpdateBridgeEnabled(publishBranch, version) })
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
