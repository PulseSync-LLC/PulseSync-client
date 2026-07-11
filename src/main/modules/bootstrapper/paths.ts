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
    hostBundle: string | null
    launcher: BootstrapperLauncher | null
    stateRoot: string
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

    if (process.platform === 'darwin' && path.basename(executableDir) === 'MacOS' && path.basename(parentDir) === 'Contents') {
        const hostBundle = path.dirname(parentDir)
        return {
            appExecutable,
            appExecutableName: path.relative(hostBundle, appExecutable),
            hostBundle,
            stateRoot: app.getPath('userData'),
        }
    }

    if (path.basename(executableDir).toLowerCase() === 'app') {
        return {
            appExecutable,
            appExecutableName: path.basename(appExecutable),
            hostBundle: null,
            stateRoot: parentDir,
        }
    }

    if (path.basename(executableDir).toLowerCase().startsWith('app-')) {
        return {
            appExecutable,
            appExecutableName: path.basename(appExecutable),
            hostBundle: null,
            stateRoot: parentDir,
        }
    }

    return {
        appExecutable,
        appExecutableName: path.basename(appExecutable),
        hostBundle: null,
        stateRoot: executableDir,
    }
}

function getRuntimeLayout() {
    const appPayload = getAppPayloadInfo()
    const stateRoot = appPayload.stateRoot
    const appExecutableName = appPayload.appExecutableName

    return {
        appExecutableName,
        appDir: path.join(stateRoot, 'app'),
        appExecutable: appPayload.appExecutable,
        bootstrapperDir: path.join(stateRoot, BOOTSTRAPPER_DIR_NAME),
        hostBundle: appPayload.hostBundle,
        stateRoot,
        modulesDir: path.join(stateRoot, 'modules'),
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
    const layout = getRuntimeLayout()
    if (process.platform === 'darwin' && layout.hostBundle) {
        return resolveLauncherFromDir(path.join(layout.hostBundle, 'Contents', 'Resources', BOOTSTRAPPER_DIR_NAME))
    }
    return resolveLauncherFromDir(layout.bootstrapperDir)
}

export function getBootstrapperRuntimePaths(): BootstrapperRuntimePaths {
    const layout = getRuntimeLayout()
    return {
        appExecutable: layout.appExecutable,
        appExecutableName: layout.appExecutableName,
        hostBundle: layout.hostBundle,
        launcher: isAppDev ? resolveDevLauncher() : resolveInstalledLauncher(),
        stateRoot: layout.stateRoot,
    }
}
