import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { BootstrapperLauncher } from './paths'

export type BootstrapperRelaunchOptions = {
    appExecutableName: string
    appExecutable: string
    installRoot: string
    launcher: BootstrapperLauncher
    transactionRoot: string
}

export type BootstrapperStartInvocation = {
    args: string[]
    command: string
    env: Record<string, string>
    launcherKind: BootstrapperLauncher['kind']
    launcherSource: BootstrapperLauncher['source']
}

export type BootstrapperRelaunchResult = BootstrapperStartInvocation & {
    pid?: number
    spawned: boolean
}

type SpawnBootstrapper = typeof spawn

export function createBootstrapperStartInvocation(options: BootstrapperRelaunchOptions): BootstrapperStartInvocation {
    return {
        command: options.launcher.command,
        args: [
            ...options.launcher.args,
            'start',
            '--install-root',
            options.installRoot,
            '--app-executable-name',
            options.appExecutableName,
            '--app-executable',
            options.appExecutable,
            '--transaction-root',
            options.transactionRoot,
            '--json',
        ],
        env: options.launcher.env,
        launcherKind: options.launcher.kind,
        launcherSource: options.launcher.source,
    }
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
    return new Promise((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
    })
}

export async function relaunchThroughBootstrapper(
    options: BootstrapperRelaunchOptions,
    spawnBootstrapper: SpawnBootstrapper = spawn,
): Promise<BootstrapperRelaunchResult> {
    const invocation = createBootstrapperStartInvocation(options)
    const child = spawnBootstrapper(invocation.command, invocation.args, {
        detached: true,
        env: {
            ...process.env,
            ...invocation.env,
        },
        stdio: 'ignore',
        windowsHide: true,
    }) as ChildProcessWithoutNullStreams

    await waitForSpawn(child)
    child.unref()

    return {
        ...invocation,
        pid: child.pid,
        spawned: true,
    }
}
