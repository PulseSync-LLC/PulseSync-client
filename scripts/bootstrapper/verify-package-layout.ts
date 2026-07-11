import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..', '..')

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
    if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
        return false
    }

    return fs.readdirSync(directoryPath, { withFileTypes: true }).some(entry => {
        const entryPath = path.join(directoryPath, entry.name)
        return entry.isFile() || (entry.isDirectory() && hasFiles(entryPath))
    })
}

function requireModuleFile(installRoot: string, moduleName: string, fileName: string): string {
    const modulesDir = requirePath(path.join(installRoot, 'modules'), 'directory')
    const containers = fs
        .readdirSync(modulesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith(`${moduleName}-`))
    if (containers.length !== 1) throw new Error(`Expected one ${moduleName}-<version> directory in ${modulesDir}`)
    return requirePath(path.join(modulesDir, containers[0].name, moduleName, fileName), 'file')
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

function rejectBootstrapperEntrypointScript(targetPath: string): void {
    const head = fs.readFileSync(targetPath).subarray(0, 4096).toString('utf-8')
    if (head.includes('bootstrapper/pulsesync-bootstrapper') && head.includes(' start ')) {
        throw new Error(`Expected app payload executable, got bootstrapper setup entrypoint: ${targetPath}`)
    }
}

function nativeExecutableName(platform: TargetPlatform): string {
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

function main(): void {
    const args = process.argv.slice(2)
    const installRootArg = readArgValue(args, '--install-root')
    if (!installRootArg) {
        throw new Error('Usage: tsx scripts/bootstrapper/verify-package-layout.ts --install-root <path> [--platform win32|darwin|linux]')
    }

    const platform = readTargetPlatform(args)
    const installRoot = resolveInsideProject(installRootArg)
    if (platform === 'darwin') {
        const contentsDir = requirePath(path.join(installRoot, 'Contents'), 'directory')
        const resourcesDir = requirePath(path.join(contentsDir, 'Resources'), 'directory')
        const hostExecutable = requirePath(path.join(contentsDir, 'MacOS', 'PulseSync'), 'file')
        const installedBootstrapperDir = requirePath(path.join(resourcesDir, 'bootstrapper'), 'directory')
        const installedNativeExecutable = requirePath(path.join(installedBootstrapperDir, 'pulsesync-bootstrapper'), 'file')
        const modulesDir = requirePath(path.join(contentsDir, 'modules'), 'directory')
        const artifactWorkerFile = requireModuleFile(contentsDir, 'artifactWorker', 'artifactWorker.cjs')
        const nativeModuleFile = requireModuleFile(contentsDir, 'pulsesyncNative', 'pulsesyncNative.node')
        requireExecutableBit(hostExecutable)
        requireExecutableBit(installedNativeExecutable)
        rejectBootstrapperEntrypointScript(hostExecutable)
        rejectPath(path.join(contentsDir, 'current.json'))
        rejectPath(path.join(contentsDir, 'updates'))
        if (fs.readdirSync(contentsDir).some(name => /^app-/iu.test(name))) {
            throw new Error(`Expected no versioned app directories inside macOS bundle: ${contentsDir}`)
        }
        console.log(
            JSON.stringify(
                {
                    state: 'ok',
                    platform,
                    installRoot,
                    installedBootstrapperDir,
                    hostExecutable,
                    installedNativeExecutable,
                    artifactWorkerFile,
                    modulesHasFiles: hasFiles(modulesDir),
                    nativeModuleFile,
                },
                null,
                4,
            ),
        )
        return
    }
    const installedBootstrapperDir = requirePath(path.join(installRoot, 'bootstrapper'), 'directory')
    const updatesDir = requirePath(path.join(installRoot, 'updates'), 'directory')
    const installedNativeExecutable = requirePath(path.join(installedBootstrapperDir, nativeExecutableName(platform)), 'file')
    const hostExecutable = requirePath(path.join(installRoot, 'host', appExecutableName(platform)), 'file')
    if (platform !== 'win32') {
        requireExecutableBit(installedNativeExecutable)
        requireExecutableBit(hostExecutable)
        rejectBootstrapperEntrypointScript(hostExecutable)
    }
    rejectPath(path.join(installRoot, appExecutableName(platform)))
    const modulesDir = path.join(installRoot, 'modules')
    const artifactWorkerFile = requireModuleFile(installRoot, 'artifactWorker', 'artifactWorker.cjs')
    const nativeModuleFile = requireModuleFile(installRoot, 'pulsesyncNative', 'pulsesyncNative.node')
    const desktopCoreEntry = requireModuleFile(installRoot, 'desktopCore', 'index.cjs')
    const desktopCorePreload = requireModuleFile(installRoot, 'desktopCore', 'mainWindowPreload.cjs')
    rejectPath(path.join(installRoot, 'native'))
    rejectPath(path.join(installRoot, 'host', 'modules'))
    rejectPath(path.join(modulesDir, 'artifactWorker.cjs'))

    const result = {
        state: 'ok',
        platform,
        installRoot,
        installedBootstrapperDir,
        hostExecutable,
        installedNativeExecutable,
        updatesDir,
        artifactWorkerFile,
        modulesHasFiles: hasFiles(modulesDir),
        nativeModuleFile,
        desktopCoreEntry,
        desktopCorePreload,
    }

    console.log(JSON.stringify(result, null, 4))
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
