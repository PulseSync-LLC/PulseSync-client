import 'dotenv/config'
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

function resolveInsideProject(targetPath: string): string {
    const resolvedPath = path.resolve(projectRoot, targetPath)
    const relativePath = path.relative(projectRoot, resolvedPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Path must stay inside the project: ${targetPath}`)
    }
    return resolvedPath
}

async function runCargoBuild(): Promise<void> {
    await execFileAsync('cargo', ['build', '--manifest-path', path.join(bootstrapperRoot, 'Cargo.toml'), '--release'], {
        cwd: projectRoot,
        windowsHide: true,
    })
}

function bootstrapperExecutableName(): string {
    return process.platform === 'win32' ? 'pulsesync-bootstrapper.exe' : 'pulsesync-bootstrapper'
}

function resolveBootstrapperExecutable(): string {
    const executablePath = path.join(bootstrapperRoot, 'target', 'release', bootstrapperExecutableName())
    if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
        throw new Error(`Bootstrapper executable was not found: ${executablePath}`)
    }

    return executablePath
}

export async function buildBootstrapperExecutable(): Promise<string> {
    await runCargoBuild()
    return resolveBootstrapperExecutable()
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

async function publishBootstrapper(args: string[]): Promise<void> {
    const channel = readArgValue(args, '--channel')
    const dist = readArgValue(args, '--dist') || `${process.platform}-${process.arch}`
    if (!channel || !/^[a-z0-9][a-z0-9-]*$/u.test(channel)) {
        throw new Error('Usage: tsx scripts/bootstrapper/build.ts publish --channel <name> [--dist win32-x64]')
    }
    const s3Url = process.env.S3_URL?.trim()
    if (!s3Url) throw new Error('S3_URL is required to publish bootstrapper updates')

    const releaseDir = path.join(projectRoot, 'release', 'bootstrapper')
    fs.rmSync(releaseDir, { force: true, recursive: true })
    const executable = await buildBootstrapperExecutable()
    const baseUrl = `${s3Url.replace(/\/+$/u, '')}/builds/app/${channel}`
    const previousManifestUrl = `${baseUrl}/desktop-update-${dist}.json?_=${Date.now()}`
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
    await publishToS3(channel, releaseDir, version, { keepRecentVersions: null })
    console.log(`PulseSync bootstrapper ${version} published for ${channel}/${dist}; desktop core remains ${manifest.desktopVersion}`)
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

    throw new Error(`Unknown bootstrapper build command: ${command}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
}
