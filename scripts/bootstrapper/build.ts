import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { emitBootstrapperUpdateManifest } from '../desktop-release-manifest.js'
import { publishToS3 } from '../s3-upload.js'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')
const bootstrapperRoot = path.join(projectRoot, 'packages', 'bootstrapper')
const packagedBootstrapperDirName = 'bootstrapper'

type CopyOptions = {
    build?: boolean
    installRoot: string
}

type BuildOptions = {
    target?: string
}

type PreparedBootstrapperRelease = {
    channel: string
    desktopVersion: string
    dist: string
    releaseDir: string
    version: string
}

const MAC_UNIVERSAL_TARGETS = ['x86_64-apple-darwin', 'aarch64-apple-darwin'] as const

function cargoBuildEnvironment(): NodeJS.ProcessEnv {
    const rustFlags = [process.env.RUSTFLAGS, ...(process.platform === 'win32' ? ['-C link-arg=/Brepro'] : [])].filter(Boolean).join(' ')
    return { ...process.env, RUSTFLAGS: rustFlags }
}

function resolveInsideProject(targetPath: string): string {
    const resolvedPath = path.resolve(projectRoot, targetPath)
    const relativePath = path.relative(projectRoot, resolvedPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Path must stay inside the project: ${targetPath}`)
    }
    return resolvedPath
}

async function runCargoBuild(options: BuildOptions = {}): Promise<void> {
    const args = ['build', '--manifest-path', path.join(bootstrapperRoot, 'Cargo.toml'), '--release']
    if (options.target) args.push('--target', options.target)
    await execFileAsync('cargo', args, {
        cwd: projectRoot,
        env: cargoBuildEnvironment(),
        windowsHide: true,
    })
}

function collectFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name)
        return entry.isDirectory() ? collectFiles(entryPath) : [entryPath]
    })
}

async function bootstrapperBuildInputsSha256(options: BuildOptions): Promise<string> {
    const { stdout: rustc } = await execFileAsync('rustc', ['--version', '--verbose'], { cwd: projectRoot, windowsHide: true })
    const inputs = ['Cargo.lock', 'Cargo.toml', 'build.rs']
        .map(relativePath => path.join(bootstrapperRoot, relativePath))
        .concat(collectFiles(path.join(bootstrapperRoot, 'src')), [fileURLToPath(import.meta.url)])
        .sort()
    const hash = crypto.createHash('sha256')
    for (const input of inputs) {
        hash.update(path.relative(projectRoot, input).replace(/\\/gu, '/'))
        hash.update('\0')
        hash.update(fs.readFileSync(input))
        hash.update('\0')
    }
    hash.update(
        JSON.stringify({
            arch: process.arch,
            cargoBuildTarget: process.env.CARGO_BUILD_TARGET ?? '',
            platform: process.platform,
            rustFlags: cargoBuildEnvironment().RUSTFLAGS ?? '',
            rustc,
            target: options.target ?? '',
        }),
    )
    return hash.digest('hex')
}

function bootstrapperExecutableName(): string {
    return process.platform === 'win32' ? 'pulsesync-bootstrapper.exe' : 'pulsesync-bootstrapper'
}

function bootstrapperExecutablePath(options: BuildOptions = {}): string {
    return path.join(bootstrapperRoot, 'target', ...(options.target ? [options.target] : []), 'release', bootstrapperExecutableName())
}

function resolveBootstrapperExecutable(options: BuildOptions = {}): string {
    const executablePath = bootstrapperExecutablePath(options)
    if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
        throw new Error(`Bootstrapper executable was not found: ${executablePath}`)
    }

    return executablePath
}

export async function buildBootstrapperExecutable(options: BuildOptions = {}): Promise<string> {
    const executablePath = bootstrapperExecutablePath(options)
    const stampPath = `${executablePath}.build-inputs.sha256`
    const buildInputs = await bootstrapperBuildInputsSha256(options)
    if (process.env.CI && fs.existsSync(executablePath) && !fs.existsSync(stampPath)) {
        fs.writeFileSync(stampPath, `${buildInputs}\n`, 'utf8')
        return executablePath
    }
    if (fs.existsSync(executablePath) && fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8').trim() === buildInputs) {
        return executablePath
    }
    await runCargoBuild(options)
    const executable = resolveBootstrapperExecutable(options)
    fs.writeFileSync(stampPath, `${buildInputs}\n`, 'utf8')
    return executable
}

export async function buildUniversalMacBootstrapperExecutable(): Promise<string> {
    if (process.platform !== 'darwin') {
        throw new Error('Universal bootstrapper builds are only supported on macOS')
    }
    const slices: string[] = []
    for (const target of MAC_UNIVERSAL_TARGETS) {
        slices.push(await buildBootstrapperExecutable({ target }))
    }
    const outputDir = path.join(bootstrapperRoot, 'target', 'universal', 'release')
    const outputPath = path.join(outputDir, bootstrapperExecutableName())
    fs.mkdirSync(outputDir, { recursive: true })
    fs.rmSync(outputPath, { force: true })
    await execFileAsync('/usr/bin/lipo', ['-create', ...slices, '-output', outputPath], { cwd: projectRoot })
    await execFileAsync('/usr/bin/lipo', [outputPath, '-verify_arch', 'x86_64', 'arm64'], { cwd: projectRoot })
    return outputPath
}

export async function copyBootstrapperToInstallRoot(installRoot: string, options: { build?: boolean } = {}): Promise<string> {
    const executable = options.build === false ? resolveBootstrapperExecutable() : await buildBootstrapperExecutable()
    const resolvedInstallRoot = resolveInsideProject(installRoot)
    const targetDir = path.join(resolvedInstallRoot, packagedBootstrapperDirName)

    fs.rmSync(targetDir, { force: true, recursive: true })
    fs.mkdirSync(targetDir, { recursive: true })
    const targetExecutable = path.join(targetDir, bootstrapperExecutableName())
    fs.copyFileSync(executable, targetExecutable)
    if (process.platform !== 'win32') {
        fs.chmodSync(targetExecutable, 0o755)
    }
    fs.mkdirSync(path.join(resolvedInstallRoot, 'updates'), { recursive: true })

    return targetDir
}

function readArgValue(args: string[], name: string): string | null {
    const index = args.indexOf(name)
    if (index === -1) {
        return null
    }

    return args[index + 1] ?? null
}

async function prepareBootstrapperRelease(args: string[]): Promise<PreparedBootstrapperRelease> {
    const channel = readArgValue(args, '--channel')
    const dist = readArgValue(args, '--dist') || `${process.platform}-${process.arch}`
    if (!channel || !/^[a-z0-9][a-z0-9-]*$/u.test(channel)) {
        throw new Error('Usage: tsx scripts/bootstrapper/build.ts <prepare|publish> --channel <name> [--dist win32-x64]')
    }
    const s3Url = process.env.S3_URL?.trim()
    if (!s3Url) throw new Error('S3_URL is required to publish bootstrapper updates')

    const releaseDir = path.join(projectRoot, 'release', 'bootstrapper')
    fs.rmSync(releaseDir, { force: true, recursive: true })
    const executable = process.platform === 'darwin' ? await buildUniversalMacBootstrapperExecutable() : await buildBootstrapperExecutable()
    const baseUrl = `${s3Url.replace(/\/+$/u, '')}/builds/app/${channel}`
    const manifestName = process.platform === 'darwin' ? `desktop-update-hybrid-${dist}.json` : `desktop-update-${dist}.json`
    const previousManifestUrl = `${baseUrl}/${manifestName}?_=${Date.now()}`
    const metadataVersion = process.env.DESKTOP_METADATA_VERSION?.trim() || String(Date.now())
    const manifestPath = await emitBootstrapperUpdateManifest({
        baseUrl,
        bootstrapperExecutable: executable,
        channel,
        dist,
        metadataVersion,
        previousManifestUrl,
        releaseDir,
    })
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        desktopVersion: string
        targets: Record<string, { bootstrapper?: { version: string } }>
    }
    const version = manifest.targets[dist]?.bootstrapper?.version
    if (!version) throw new Error(`Generated manifest does not contain bootstrapper for ${dist}`)

    return { channel, desktopVersion: manifest.desktopVersion, dist, releaseDir, version }
}

async function publishBootstrapper(args: string[]): Promise<void> {
    const { channel, desktopVersion, dist, releaseDir, version } = await prepareBootstrapperRelease(args)
    if (process.env.PULSESYNC_DEFER_S3_PUBLISH === '1') {
        console.log(`PulseSync bootstrapper ${version} prepared for ${channel}/${dist}; desktop core remains ${desktopVersion}`)
        return
    }
    await publishToS3(channel, releaseDir, version, { keepRecentVersions: null })
    console.log(`PulseSync bootstrapper ${version} published for ${channel}/${dist}; desktop core remains ${desktopVersion}`)
}

function parseCopyOptions(args: string[]): CopyOptions {
    const installRoot = readArgValue(args, '--install-root')
    if (!installRoot) {
        throw new Error('Usage: tsx scripts/bootstrapper/build.ts copy --install-root <path> [--no-build]')
    }

    return {
        installRoot,
        build: !args.includes('--no-build'),
    }
}

async function main(): Promise<void> {
    const [command = 'build', ...args] = process.argv.slice(2)

    if (command === 'build') {
        const executable = await buildBootstrapperExecutable()
        console.log(`PulseSync bootstrapper built: ${executable}`)
        return
    }

    if (command === 'copy') {
        const options = parseCopyOptions(args)
        const outputDir = await copyBootstrapperToInstallRoot(options.installRoot, { build: options.build })
        console.log(`PulseSync bootstrapper copied: ${outputDir}`)
        return
    }

    if (command === 'publish') {
        await publishBootstrapper(args)
        return
    }

    if (command === 'prepare') {
        const prepared = await prepareBootstrapperRelease(args)
        console.log(
            `PulseSync bootstrapper ${prepared.version} prepared for ${prepared.channel}/${prepared.dist}; desktop core remains ${prepared.desktopVersion}`,
        )
        return
    }

    throw new Error(`Unknown bootstrapper build command: ${command}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
