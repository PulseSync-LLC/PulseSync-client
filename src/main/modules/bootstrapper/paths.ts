import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import isAppDev from '../../utils/isAppDev'

export type BootstrapperLauncherKind = 'executable'

export type BootstrapperLauncher = {
    args: string[]
    command: string
    env: Record<string, string>
    kind: BootstrapperLauncherKind
    source: 'dev-dist' | 'installed-layout'
}

export type BootstrapperRuntimePaths = {
    appExecutable: string
    appExecutableName: string
    installRoot: string
    launcher: BootstrapperLauncher | null
}

const BOOTSTRAPPER_DIR_NAME = 'bootstrapper'

function existingFile(filePath: string): string | null {
    try {
        return fs.statSync(filePath).isFile() ? filePath : null
    } catch {
        return null
    }
}

function executableName(): string {
    if (process.platform === 'win32') {
        return 'pulsesync-bootstrapper.exe'
    }

    return 'pulsesync-bootstrapper'
}

function getAppExecutablePath(): string {
    return app.getPath('exe')
}

function getAppPayloadInfo() {
    const appExecutable = getAppExecutablePath()
    const executableDir = path.dirname(appExecutable)
    const parentDir = path.dirname(executableDir)

    if (path.basename(executableDir).toLowerCase() === 'app') {
        return {
            appExecutable,
            appExecutableName: path.basename(appExecutable),
            installRoot: parentDir,
        }
    }

    if (path.basename(executableDir).toLowerCase().startsWith('app-')) {
        return {
            appExecutable,
            appExecutableName: path.basename(appExecutable),
            installRoot: parentDir,
        }
    }

    if (process.platform === 'darwin' && path.basename(executableDir) === 'MacOS' && path.basename(parentDir).toLowerCase() === 'app') {
        return {
            appExecutable,
            appExecutableName: path.join('MacOS', path.basename(appExecutable)),
            installRoot: path.dirname(parentDir),
        }
    }

    if (process.platform === 'darwin' && path.basename(executableDir) === 'MacOS' && path.basename(parentDir).toLowerCase().startsWith('app-')) {
        return {
            appExecutable,
            appExecutableName: path.join('MacOS', path.basename(appExecutable)),
            installRoot: path.dirname(parentDir),
        }
    }

    return {
        appExecutable,
        appExecutableName: path.basename(appExecutable),
        installRoot: executableDir,
    }
}

function getInstalledRootFromAppExecutable(): string {
    return getAppPayloadInfo().installRoot
}

function getRuntimeLayout() {
    const appPayload = getAppPayloadInfo()
    const installRoot = appPayload.installRoot
    const appExecutableName = appPayload.appExecutableName

    return {
        appExecutableName,
        appDir: path.join(installRoot, 'app'),
        appExecutable: appPayload.appExecutable,
        bootstrapperDir: path.join(installRoot, BOOTSTRAPPER_DIR_NAME),
        installRoot,
        modulesDir: path.join(installRoot, 'modules'),
    }
}

function resolveDevLauncher(): BootstrapperLauncher | null {
    const nativeReleasePath = existingFile(path.resolve(process.cwd(), 'packages', 'bootstrapper', 'target', 'release', executableName()))
    if (nativeReleasePath) {
        return {
            command: nativeReleasePath,
            args: [],
            env: {},
            kind: 'executable',
            source: 'dev-dist',
        }
    }

    const nativeDebugPath = existingFile(path.resolve(process.cwd(), 'packages', 'bootstrapper', 'target', 'debug', executableName()))
    if (nativeDebugPath) {
        return {
            command: nativeDebugPath,
            args: [],
            env: {},
            kind: 'executable',
            source: 'dev-dist',
        }
    }

    return null
}

function resolveLauncherFromDir(bootstrapperDir: string): BootstrapperLauncher | null {
    const executablePath = existingFile(path.join(bootstrapperDir, executableName()))
    if (!executablePath) {
        return null
    }

    return {
        command: executablePath,
        args: [],
        env: {},
        kind: 'executable',
        source: 'installed-layout',
    }
}

function resolveInstalledLauncher(): BootstrapperLauncher | null {
    return resolveLauncherFromDir(getRuntimeLayout().bootstrapperDir)
}

export function getBootstrapperRuntimePaths(): BootstrapperRuntimePaths {
    const layout = getRuntimeLayout()
    return {
        appExecutable: layout.appExecutable,
        appExecutableName: layout.appExecutableName,
        installRoot: layout.installRoot,
        launcher: isAppDev ? resolveDevLauncher() : resolveInstalledLauncher(),
    }
}
