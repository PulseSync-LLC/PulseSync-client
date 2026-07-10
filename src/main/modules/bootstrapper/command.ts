import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { BootstrapperLauncher } from './paths'

const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_LINE_BYTES = 256 * 1024
const MAX_STDIN_BYTES = 64 * 1024
const MAX_DIAGNOSTICS = 64

export type BootstrapperCommandInvocation = {
    args: string[]
    command: string
    launcherKind: BootstrapperLauncher['kind']
    launcherSource: BootstrapperLauncher['source']
}

export type RunBootstrapperCommandOptions<TResult, TProgress = never> = {
    args?: string[]
    command: string
    launcher: BootstrapperLauncher
    onDiagnostic?: (line: string) => void
    onProgress?: (progress: TProgress) => void
    parseProgress?: (value: unknown) => TProgress | null
    parseResult: (value: unknown) => TResult
    progressJson?: boolean
    stdin?: Buffer | string
}

export class BootstrapperCommandError<TResult = unknown> extends Error {
    public readonly diagnostics: readonly string[]
    public readonly exitCode: number | null
    public readonly invocation: BootstrapperCommandInvocation
    public readonly originalCause: unknown
    public readonly result: TResult | undefined

    public constructor(options: {
        cause?: unknown
        diagnostics: readonly string[]
        exitCode: number | null
        invocation: BootstrapperCommandInvocation
        message: string
        result?: TResult
    }) {
        super(options.message)
        this.name = 'BootstrapperCommandError'
        this.diagnostics = options.diagnostics
        this.exitCode = options.exitCode
        this.invocation = options.invocation
        this.originalCause = options.cause
        this.result = options.result
    }
}

export function createBootstrapperCommandInvocation(
    options: Pick<RunBootstrapperCommandOptions<unknown, unknown>, 'args' | 'command' | 'launcher' | 'progressJson'>,
): BootstrapperCommandInvocation {
    return {
        command: options.launcher.command,
        args: [
            ...options.launcher.args,
            options.command,
            '--json',
            ...(options.progressJson ? ['--progress-json'] : []),
            ...(options.args ?? []),
        ],
        launcherKind: options.launcher.kind,
        launcherSource: options.launcher.source,
    }
}

export async function runBootstrapperCommand<TResult, TProgress = never>(
    options: RunBootstrapperCommandOptions<TResult, TProgress>,
): Promise<TResult> {
    const invocation = createBootstrapperCommandInvocation(options)
    const stdin = typeof options.stdin === 'string' ? Buffer.from(options.stdin, 'utf8') : options.stdin
    if (stdin && stdin.byteLength > MAX_STDIN_BYTES) {
        throw new BootstrapperCommandError({
            diagnostics: [],
            exitCode: null,
            invocation,
            message: `Bootstrapper stdin exceeds ${MAX_STDIN_BYTES} bytes`,
        })
    }

    return await new Promise<TResult>((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
            env: {
                ...process.env,
                ...options.launcher.env,
            },
            stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
            windowsHide: true,
        })
        const stdoutStream = child.stdout
        const stderrStream = child.stderr
        if (!stdoutStream || !stderrStream) {
            reject(
                new BootstrapperCommandError({
                    diagnostics: [],
                    exitCode: null,
                    invocation,
                    message: 'Bootstrapper pipes were not created',
                }),
            )
            return
        }
        const stdout: Buffer[] = []
        const diagnostics: string[] = []
        const stderrDecoder = new StringDecoder('utf8')
        let stderrRemainder = ''
        let stdoutBytes = 0
        let stdoutOverflow = false
        let settled = false

        const recordDiagnostic = (line: string): void => {
            const normalized = line.trim().slice(0, MAX_STDERR_LINE_BYTES)
            if (!normalized) {
                return
            }
            if (diagnostics.length < MAX_DIAGNOSTICS) {
                diagnostics.push(normalized)
            }
            options.onDiagnostic?.(normalized)
        }

        const processStderrLine = (line: string): void => {
            if (!options.parseProgress) {
                recordDiagnostic(line)
                return
            }
            try {
                const progress = options.parseProgress(JSON.parse(line) as unknown)
                if (progress !== null) {
                    options.onProgress?.(progress)
                    return
                }
            } catch {
                // A diagnostic line is allowed to be non-JSON or use an unknown schema.
            }
            recordDiagnostic(line)
        }

        const consumeStderr = (text: string, flush: boolean): void => {
            stderrRemainder += text
            let newline = stderrRemainder.indexOf('\n')
            while (newline >= 0) {
                processStderrLine(stderrRemainder.slice(0, newline).replace(/\r$/u, ''))
                stderrRemainder = stderrRemainder.slice(newline + 1)
                newline = stderrRemainder.indexOf('\n')
            }
            if (Buffer.byteLength(stderrRemainder, 'utf8') > MAX_STDERR_LINE_BYTES) {
                recordDiagnostic(stderrRemainder)
                stderrRemainder = ''
            }
            if (flush && stderrRemainder) {
                processStderrLine(stderrRemainder.replace(/\r$/u, ''))
                stderrRemainder = ''
            }
        }

        stdoutStream.on('data', chunk => {
            const buffer = Buffer.from(chunk)
            stdoutBytes += buffer.byteLength
            if (stdoutBytes <= MAX_STDOUT_BYTES) {
                stdout.push(buffer)
            } else {
                stdoutOverflow = true
            }
        })
        stderrStream.on('data', chunk => consumeStderr(stderrDecoder.write(Buffer.from(chunk)), false))

        child.once('error', cause => {
            if (settled) {
                return
            }
            settled = true
            reject(
                new BootstrapperCommandError({
                    cause,
                    diagnostics,
                    exitCode: null,
                    invocation,
                    message: `Failed to spawn bootstrapper: ${cause.message}`,
                }),
            )
        })

        child.once('close', code => {
            consumeStderr(stderrDecoder.end(), true)
            if (settled) {
                return
            }
            settled = true
            if (stdoutOverflow) {
                reject(
                    new BootstrapperCommandError({
                        diagnostics,
                        exitCode: code,
                        invocation,
                        message: `Bootstrapper stdout exceeds ${MAX_STDOUT_BYTES} bytes`,
                    }),
                )
                return
            }
            const output = Buffer.concat(stdout).toString('utf8').trim()
            let parsed: unknown
            try {
                parsed = JSON.parse(output) as unknown
            } catch (cause) {
                reject(
                    new BootstrapperCommandError({
                        cause,
                        diagnostics,
                        exitCode: code,
                        invocation,
                        message: 'Bootstrapper returned malformed final JSON',
                    }),
                )
                return
            }
            let result: TResult
            try {
                result = options.parseResult(parsed)
            } catch (cause) {
                reject(
                    new BootstrapperCommandError({
                        cause,
                        diagnostics,
                        exitCode: code,
                        invocation,
                        message: 'Bootstrapper returned an invalid result contract',
                    }),
                )
                return
            }
            if (code !== 0) {
                reject(
                    new BootstrapperCommandError({
                        diagnostics,
                        exitCode: code,
                        invocation,
                        message: `Bootstrapper command exited with code ${code ?? 'unknown'}`,
                        result,
                    }),
                )
                return
            }
            resolve(result)
        })

        if (stdin && child.stdin) {
            child.stdin.on('error', error => recordDiagnostic(`stdin: ${error.message}`))
            child.stdin.end(stdin)
        }
    })
}
