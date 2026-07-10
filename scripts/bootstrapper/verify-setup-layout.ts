import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')

type BootstrapperSetupConfig = {
    appExecutableName?: unknown
    dist?: unknown
    githubChannel?: unknown
    installedVersion?: unknown
    manifestUrl?: unknown
    schemaVersion?: unknown
    serverHealthUrl?: unknown
}

type VerifiedBootstrapperSetupConfig = {
    appExecutableName: string
    dist: string
    githubChannel: string
    installedVersion: string
    manifestUrl: string
    schemaVersion: 1
    serverHealthUrl: string
}

type TargetPlatform = 'darwin' | 'linux' | 'win32'

function readArgValue(args: string[], name: string): string | null {
    const index = args.indexOf(name)
    if (index === -1) return null
    return args[index + 1] ?? null
}

function readTargetPlatform(args: string[]): TargetPlatform {
    const rawPlatform = readArgValue(args, '--platform') ?? process.platform
    if (rawPlatform === 'win32' || rawPlatform === 'darwin' || rawPlatform === 'linux') {
        return rawPlatform
    }

    throw new Error(`Unsupported target platform: ${rawPlatform}`)
}

function readTargetArch(args: string[]): string {
    const rawArch = readArgValue(args, '--arch') ?? process.arch
    if (!/^[a-z0-9_-]+$/iu.test(rawArch)) {
        throw new Error(`Unsupported target arch: ${rawArch}`)
    }
    return rawArch
}

function resolveInsideProject(targetPath: string): string {
    const resolvedPath = path.resolve(projectRoot, targetPath)
    const relativePath = path.relative(projectRoot, resolvedPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Path must stay inside the project: ${targetPath}`)
    }
    return resolvedPath
}

function requirePath(targetPath: string, kind: 'directory' | 'file'): string {
    const stat = fs.statSync(targetPath)
    if (kind === 'directory' && !stat.isDirectory()) {
        throw new Error(`Expected directory: ${targetPath}`)
    }
    if (kind === 'file' && !stat.isFile()) {
        throw new Error(`Expected file: ${targetPath}`)
    }
    return targetPath
}

function rejectPath(targetPath: string): void {
    if (fs.existsSync(targetPath)) {
        throw new Error(`Expected path to be absent: ${targetPath}`)
    }
}

function hasFiles(directoryPath: string): boolean {
    if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) return false
    return fs.readdirSync(directoryPath, { withFileTypes: true }).some(entry => {
        const entryPath = path.join(directoryPath, entry.name)
        return entry.isFile() || (entry.isDirectory() && hasFiles(entryPath))
    })
}

function bootstrapperResourcesDir(installRoot: string, platform: TargetPlatform): string {
    return platform === 'darwin' ? path.join(installRoot, 'Resources') : path.join(installRoot, 'resources')
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Expected non-empty string in bootstrapper config: ${label}`)
    }
    return value
}

function readBootstrapperConfig(configPath: string): VerifiedBootstrapperSetupConfig {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as BootstrapperSetupConfig
    if (config.schemaVersion !== 1) {
        throw new Error(`Expected bootstrapper config schemaVersion=1: ${configPath}`)
    }

    return {
        schemaVersion: config.schemaVersion,
        manifestUrl: requireString(config.manifestUrl, 'manifestUrl'),
        serverHealthUrl: requireString(config.serverHealthUrl, 'serverHealthUrl'),
        githubChannel: requireString(config.githubChannel, 'githubChannel'),
        dist: requireString(config.dist, 'dist'),
        installedVersion: requireString(config.installedVersion, 'installedVersion'),
        appExecutableName: requireString(config.appExecutableName, 'appExecutableName'),
    }
}

function requireExecutableBit(targetPath: string): void {
    if (process.platform === 'win32') {
        return
    }

    const mode = fs.statSync(targetPath).mode
    if ((mode & 0o111) === 0) {
        throw new Error(`Expected executable file mode: ${targetPath}`)
    }
}

function requireBootstrapperEntrypointScript(targetPath: string, platform: Exclude<TargetPlatform, 'win32'>): void {
    const script = fs.readFileSync(targetPath, 'utf-8')
    const expectedLaunchLine =
        platform === 'darwin'
            ? 'exec "${APP_CONTENTS}/bootstrapper/pulsesync-bootstrapper" start --install-root "${APP_CONTENTS}" -- "$@"'
            : 'exec "${APP_DIR}/bootstrapper/pulsesync-bootstrapper" start --install-root "${APP_DIR}" -- "$@"'

    if (!script.startsWith('#!/usr/bin/env bash\n')) {
        throw new Error(`Expected bootstrapper entrypoint shebang: ${targetPath}`)
    }
    if (!script.includes('set -euo pipefail\n')) {
        throw new Error(`Expected strict bootstrapper entrypoint script: ${targetPath}`)
    }
    if (!script.includes(expectedLaunchLine)) {
        throw new Error(`Expected bootstrapper entrypoint to launch native bootstrapper: ${targetPath}`)
    }
}

function bootstrapperExecutableName(platform: TargetPlatform): string {
    return platform === 'win32' ? 'pulsesync-bootstrapper.exe' : 'pulsesync-bootstrapper'
}

function appExecutableName(platform: TargetPlatform): string {
    if (platform === 'win32') {
        return 'PulseSync.exe'
    }
    if (platform === 'darwin') {
        return path.join('MacOS', 'PulseSync')
    }
    return 'pulsesync'
}

function expectedDist(platform: TargetPlatform, arch: string): string {
    return `${platform}-${arch}`
}

function verifyEntrypoint(installRoot: string, platform: TargetPlatform): string | null {
    if (platform === 'win32') {
        rejectPath(path.join(installRoot, appExecutableName(platform)))
        return null
    }

    const entrypoint = requirePath(path.join(installRoot, appExecutableName(platform)), 'file')
    requireExecutableBit(entrypoint)
    requireBootstrapperEntrypointScript(entrypoint, platform)
    return entrypoint
}

function main(): void {
    const args = process.argv.slice(2)
    const installRootArg = readArgValue(args, '--install-root')
    if (!installRootArg) {
        throw new Error('Usage: tsx scripts/bootstrapper/verify-setup-layout.ts --install-root <path> [--platform win32|darwin|linux] [--arch x64|arm64]')
    }

    const platform = readTargetPlatform(args)
    const arch = readTargetArch(args)
    const installRoot = resolveInsideProject(installRootArg)
    const bootstrapperDir = requirePath(path.join(installRoot, 'bootstrapper'), 'directory')
    const resourcesDir = requirePath(bootstrapperResourcesDir(installRoot, platform), 'directory')
    const updatesDir = requirePath(path.join(installRoot, 'updates'), 'directory')
    const bootstrapperExecutable = requirePath(path.join(bootstrapperDir, bootstrapperExecutableName(platform)), 'file')
    if (platform !== 'win32') {
        requireExecutableBit(bootstrapperExecutable)
    }
    const configPath = requirePath(path.join(resourcesDir, 'bootstrapper.json'), 'file')
    const config = readBootstrapperConfig(configPath)
    const expectedConfigDist = expectedDist(platform, arch)
    const expectedAppExecutableName = appExecutableName(platform)

    if (config.dist !== expectedConfigDist) {
        throw new Error(`Expected bootstrapper config dist=${expectedConfigDist}, got ${config.dist}`)
    }
    if (config.appExecutableName !== expectedAppExecutableName) {
        throw new Error(`Expected bootstrapper config appExecutableName=${expectedAppExecutableName}, got ${config.appExecutableName}`)
    }
    if (!config.manifestUrl.includes(`desktop-update-${expectedConfigDist}.json`)) {
        throw new Error(`Expected bootstrapper manifestUrl to reference desktop-update-${expectedConfigDist}.json, got ${config.manifestUrl}`)
    }
    if (!config.serverHealthUrl.endsWith('/api/v2/health')) {
        throw new Error(`Expected bootstrapper serverHealthUrl to reference /api/v2/health, got ${config.serverHealthUrl}`)
    }

    let currentPath: string | null = null
    let versionedAppRoot: string | null = null
    let appPayloadExecutable: string | null = null
    let modulesDir: string | null = null
    currentPath = requirePath(path.join(installRoot, 'current.json'), 'file')
    const current = JSON.parse(fs.readFileSync(currentPath, 'utf8')) as { schemaVersion?: unknown; version?: unknown }
    if (current.schemaVersion !== 1 || typeof current.version !== 'string' || current.version !== config.installedVersion) {
        throw new Error(`Expected current.json to match installedVersion=${config.installedVersion}, got ${JSON.stringify(current)}`)
    }
    versionedAppRoot = requirePath(path.join(installRoot, `app-${current.version}`), 'directory')
    appPayloadExecutable = requirePath(path.join(versionedAppRoot, appExecutableName(platform)), 'file')
    modulesDir = requirePath(path.join(versionedAppRoot, 'modules'), 'directory')
    if (!hasFiles(modulesDir)) {
        throw new Error(`Expected versioned app modules: ${modulesDir}`)
    }

    rejectPath(path.join(installRoot, 'app'))
    rejectPath(path.join(installRoot, 'modules'))
    rejectPath(path.join(installRoot, 'native'))
    const entrypoint = verifyEntrypoint(installRoot, platform)

    const result = {
        state: 'ok',
        platform,
        arch,
        installRoot,
        bootstrapperDir,
        bootstrapperExecutable,
        configPath,
        manifestUrl: config.manifestUrl,
        serverHealthUrl: config.serverHealthUrl,
        githubChannel: config.githubChannel,
        dist: config.dist,
        installedVersion: config.installedVersion,
        appExecutableName: config.appExecutableName,
        currentPath,
        versionedAppRoot,
        appPayloadExecutable,
        modulesDir,
        entrypoint,
        resourcesDir,
        updatesDir,
    }

    console.log(JSON.stringify(result, null, 4))
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
