import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { componentContainerName, readRuntimeComponentMetadata } from '../component-layout.js'

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

function requireBootstrapperEntrypointScript(targetPath: string): void {
    const script = fs.readFileSync(targetPath, 'utf-8')
    const expectedLaunchLine = 'exec "${APP_DIR}/bootstrapper/pulsesync-bootstrapper" start --install-root "${APP_DIR}" -- "$@"'

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
    requireBootstrapperEntrypointScript(entrypoint)
    return entrypoint
}

function main(): void {
    const args = process.argv.slice(2)
    const installRootArg = readArgValue(args, '--install-root')
    if (!installRootArg) {
        throw new Error(
            'Usage: tsx scripts/bootstrapper/verify-setup-layout.ts --install-root <path> [--platform win32|darwin|linux] [--arch x64|arm64]',
        )
    }

    const platform = readTargetPlatform(args)
    const arch = readTargetArch(args)
    const installRoot = resolveInsideProject(installRootArg)
    if (platform === 'darwin') {
        const contentsDir = requirePath(path.join(installRoot, 'Contents'), 'directory')
        const resourcesDir = requirePath(path.join(contentsDir, 'Resources'), 'directory')
        const infoPlist = requirePath(path.join(contentsDir, 'Info.plist'), 'file')
        const pkgInfo = requirePath(path.join(contentsDir, 'PkgInfo'), 'file')
        const appExecutable = requirePath(path.join(contentsDir, 'MacOS', 'PulseSync'), 'file')
        const bootstrapperExecutable = requirePath(path.join(resourcesDir, 'bootstrapper', 'pulsesync-bootstrapper'), 'file')
        const runtimeDescriptor = requirePath(path.join(resourcesDir, 'pulsesync-runtime.json'), 'file')
        const runtime = JSON.parse(fs.readFileSync(runtimeDescriptor, 'utf8')) as {
            schemaVersion?: unknown
            desktopVersion?: unknown
            hostVersion?: unknown
            bundleVersion?: unknown
            components?: Record<string, { version?: unknown; required?: unknown }>
        }
        const desktopCore = runtime.components?.desktopCore
        if (
            runtime.schemaVersion !== 3 ||
            typeof runtime.desktopVersion !== 'string' ||
            !runtime.desktopVersion ||
            typeof runtime.hostVersion !== 'string' ||
            !runtime.hostVersion ||
            typeof runtime.bundleVersion !== 'string' ||
            !runtime.bundleVersion ||
            desktopCore?.version !== runtime.desktopVersion ||
            desktopCore.required !== true
        ) {
            throw new Error(`Expected packaged runtime schema v3: ${runtimeDescriptor}`)
        }
        const shortVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', infoPlist], {
            encoding: 'utf8',
        }).trim()
        const bundleVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', infoPlist], { encoding: 'utf8' }).trim()
        if (shortVersion !== runtime.desktopVersion || bundleVersion !== runtime.bundleVersion) {
            throw new Error(`Expected Info.plist versions to match packaged runtime descriptor: ${runtimeDescriptor}`)
        }
        const icons = fs.readdirSync(resourcesDir).filter(name => name.toLowerCase().endsWith('.icns'))
        if (!icons.length) {
            throw new Error(`Expected a macOS icon under ${resourcesDir}`)
        }
        requireExecutableBit(appExecutable)
        requireExecutableBit(bootstrapperExecutable)
        rejectPath(path.join(contentsDir, 'current.json'))
        rejectPath(path.join(contentsDir, 'updates'))
        rejectPath(path.join(contentsDir, 'bootstrapper'))
        if (fs.readdirSync(contentsDir).some(name => /^app-/iu.test(name))) {
            throw new Error(`Expected no nested versioned app inside ${contentsDir}`)
        }
        const executableHead = fs.readFileSync(appExecutable).subarray(0, 2).toString('utf8')
        if (executableHead === '#!') {
            throw new Error(`Expected native Electron executable, got script: ${appExecutable}`)
        }
        console.log(
            JSON.stringify(
                {
                    state: 'ok',
                    platform,
                    arch,
                    installRoot,
                    infoPlist,
                    pkgInfo,
                    appExecutable,
                    bootstrapperExecutable,
                    runtimeDescriptor,
                    icon: path.join(resourcesDir, icons[0]),
                    resourcesDir,
                },
                null,
                4,
            ),
        )
        return
    }
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

    const installStatePath = requirePath(path.join(installRoot, 'runtime', 'install-state.json'), 'file')
    const installState = JSON.parse(fs.readFileSync(installStatePath, 'utf8')) as any
    const initialBundleVersion = installState.latest?.bundleVersion
    const initialMetadataVersion = installState.latest?.metadataVersion
    const hasValidInitialVersion =
        typeof initialBundleVersion === 'string' &&
        /^\d+$/u.test(initialBundleVersion) &&
        Number.isSafeInteger(initialMetadataVersion) &&
        initialMetadataVersion >= 0 &&
        initialBundleVersion === String(initialMetadataVersion)
    if (
        installState.schemaVersion !== 3 ||
        installState.generation !== 1 ||
        installState.activation?.state !== 'confirmed' ||
        installState.activation?.generation !== 1 ||
        !hasValidInitialVersion ||
        JSON.stringify(installState.latest) !== JSON.stringify(installState.running) ||
        JSON.stringify(installState.latest) !== JSON.stringify(installState.lastSuccessful) ||
        JSON.stringify(installState.latest) !== JSON.stringify(installState.knownGood)
    ) {
        throw new Error(`Expected confirmed install-state schema v3: ${installStatePath}`)
    }
    const hostVersion = requireString(installState.latest?.host?.version, 'installState.latest.host.version')
    const hostRelativePath = requireString(installState.latest?.host?.path, 'installState.latest.host.path')
    if (!/^app-[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(hostRelativePath)) {
        throw new Error(`Expected app-scoped host path, got ${hostRelativePath}`)
    }
    const versionedHostRoot = requirePath(path.join(installRoot, hostRelativePath), 'directory')
    const hostExecutable = requirePath(path.join(versionedHostRoot, appExecutableName(platform)), 'file')
    const modulesDir = requirePath(path.join(versionedHostRoot, 'modules'), 'directory')
    if (!hasFiles(modulesDir)) {
        throw new Error(`Expected versioned runtime modules: ${modulesDir}`)
    }
    const core = installState.latest?.components?.desktopCore
    if (core?.version !== config.installedVersion) {
        throw new Error(`Expected desktopCore version=${config.installedVersion}, got ${String(core?.version)}`)
    }
    if (core?.required !== true) {
        throw new Error('Expected desktopCore to be required in install-state schema v3')
    }
    const coreDir = requirePath(path.join(installRoot, requireString(core.path, 'installState.latest.components.desktopCore.path')), 'directory')
    requirePath(path.join(coreDir, 'index.cjs'), 'file')
    requirePath(path.join(coreDir, 'mainWindowPreload.cjs'), 'file')
    const componentMetadata = readRuntimeComponentMetadata(projectRoot)
    for (const component of Object.values(componentMetadata)) {
        const installedComponent = installState.latest?.components?.[component.name]
        const expectedPath = path.join(hostRelativePath, 'modules', componentContainerName(component), component.diskName).replace(/\\/gu, '/')
        if (installedComponent?.version !== component.version || installedComponent?.path !== expectedPath) {
            throw new Error(`Unexpected installed layout for ${component.name}: ${String(installedComponent?.path)}`)
        }
        requirePath(path.join(installRoot, expectedPath), 'directory')
    }

    rejectPath(path.join(installRoot, 'app'))
    rejectPath(path.join(installRoot, 'current.json'))
    rejectPath(path.join(installRoot, 'modules'))
    if (fs.readdirSync(installRoot).some(name => /^host-/iu.test(name))) {
        throw new Error(`Expected no host-* directories inside ${installRoot}`)
    }
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
        installStatePath,
        hostVersion,
        versionedHostRoot,
        hostExecutable,
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
