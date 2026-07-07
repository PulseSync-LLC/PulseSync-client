import { spawn } from 'node:child_process'
import type { BootstrapperLauncher } from './paths'

export type BootstrapperCommandInvocation = {
    args: string[]
    command: string
    launcherKind: BootstrapperLauncher['kind']
    launcherSource: BootstrapperLauncher['source']
}

export type RunBootstrapperJsonOptions = {
    args?: string[]
    command: string
    launcher: BootstrapperLauncher
}

export function createBootstrapperCommandInvocation(options: RunBootstrapperJsonOptions): BootstrapperCommandInvocation {
    return {
        command: options.launcher.command,
        args: [...options.launcher.args, options.command, ...(options.args ?? []), '--json'],
        launcherKind: options.launcher.kind,
        launcherSource: options.launcher.source,
    }
}

export async function runBootstrapperJson<T>(options: RunBootstrapperJsonOptions): Promise<T> {
    const invocation = createBootstrapperCommandInvocation(options)

    return await new Promise<T>((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            env: {
                ...process.env,
                ...options.launcher.env,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []

        child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
        child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
        child.once('error', reject)
        child.once('close', code => {
            const output = Buffer.concat(stdout).toString('utf8').trim()
            const errorOutput = Buffer.concat(stderr).toString('utf8').trim()

            if (code !== 0) {
                reject(new Error(`Bootstrapper command failed (${code}): ${errorOutput || output || invocation.command}`))
                return
            }

            try {
                resolve(JSON.parse(output) as T)
            } catch (error) {
                reject(new Error(`Bootstrapper command returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`))
            }
        })
    })
}
