import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { parseHandoffArmedProgress, type RustHandoffArmedEventV1 } from './contracts'
import type { BootstrapperLauncher } from './paths'

export type BootstrapperRelaunchOptions = {
    activeLeaseId: string
    appExecutableName: string
    appExecutable: string
    installRoot: string
    launcher: BootstrapperLauncher
    onDiagnostic?: (line: string) => void
    passthrough?: string[]
    waitForPid: number
}

export type BootstrapperStartInvocation = {
    args: string[]
    command: string
    env: Record<string, string>
    launcherKind: BootstrapperLauncher['kind']
    launcherSource: BootstrapperLauncher['source']
}

export type BootstrapperRelaunchResult = BootstrapperStartInvocation & RustHandoffArmedEventV1 & { pid: number; spawned: true }

export function createBootstrapperStartInvocation(options: BootstrapperRelaunchOptions): BootstrapperStartInvocation {
    return {
        command: options.launcher.command,
        args: [
            ...options.launcher.args,
            'start',
            '--json',
            '--progress-json',
            '--install-root',
            options.installRoot,
            '--app-executable-name',
            options.appExecutableName,
            '--app-executable',
            options.appExecutable,
            '--wait-for-pid',
            String(options.waitForPid),
            '--active-lease-id',
            options.activeLeaseId,
            '--wait-timeout-ms',
            '60000',
            '--',
            ...(options.passthrough ?? []),
        ],
        env: options.launcher.env,
        launcherKind: options.launcher.kind,
        launcherSource: options.launcher.source,
    }
}

export async function relaunchThroughBootstrapper(options: BootstrapperRelaunchOptions): Promise<BootstrapperRelaunchResult> {
    const invocation = createBootstrapperStartInvocation(options)
    return await new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            detached: true,
            env: { ...process.env, ...invocation.env },
            stdio: ['ignore', 'ignore', 'pipe'],
            windowsHide: true,
        })
        const stderr = child.stderr
        if (!stderr) {
            reject(new Error('Bootstrapper handoff stderr pipe was not created'))
            return
        }
        const decoder = new StringDecoder('utf8')
        let remainder = ''
        let armed = false
        let settled = false

        const detach = (): void => {
            stderr.removeAllListeners()
            stderr.destroy()
            child.unref()
        }

        const processLine = (line: string): void => {
            const trimmed = line.trim()
            if (!trimmed || settled) return
            let event: RustHandoffArmedEventV1 | null = null
            try {
                event = parseHandoffArmedProgress(JSON.parse(trimmed) as unknown)
            } catch {
                event = null
            }
            if (!event) {
                options.onDiagnostic?.(trimmed)
                return
            }
            if (event.activeLeaseId !== options.activeLeaseId || event.waitingForPid !== options.waitForPid || event.rustPid !== child.pid) {
                settled = true
                detach()
                reject(new Error('Bootstrapper armed event identity mismatch'))
                return
            }
            armed = true
            settled = true
            detach()
            resolve({ ...invocation, ...event, pid: child.pid, spawned: true })
        }

        stderr.on('data', chunk => {
            remainder += decoder.write(Buffer.from(chunk))
            let newline = remainder.indexOf('\n')
            while (newline >= 0) {
                processLine(remainder.slice(0, newline).replace(/\r$/u, ''))
                remainder = remainder.slice(newline + 1)
                newline = remainder.indexOf('\n')
            }
        })
        child.once('error', error => {
            if (!settled) {
                settled = true
                reject(error)
            }
        })
        child.once('close', code => {
            if (settled) return
            const final = decoder.end()
            if (final) remainder += final
            if (remainder) processLine(remainder.replace(/\r$/u, ''))
            if (!settled && !armed) {
                settled = true
                reject(new Error(`Bootstrapper exited before handoff was armed (${code ?? 'unknown'})`))
            }
        })
    })
}
