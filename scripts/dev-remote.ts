import { type ChildProcess, spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const host = process.env.PULSESYNC_REMOTE_RENDERER_HOST || '127.0.0.1'
const port = Number(process.env.PULSESYNC_REMOTE_RENDERER_PORT || 3100)
const rendererPath = process.env.PULSESYNC_REMOTE_RENDERER_PATH || '/src/renderer/index.html'
const origin = `http://${host}:${port}`
const manifestPath = '/desktop/manifest.json'

export const remoteRendererDevConfig = {
    host,
    port,
    rendererPath,
    origin,
    manifestPath,
    rendererUrl: `${origin}${rendererPath}`,
    manifestUrl: `${origin}${manifestPath}`,
}

const { manifestUrl } = remoteRendererDevConfig

const isWindows = process.platform === 'win32'

const runCommand = (command: string, args: string[], env?: NodeJS.ProcessEnv): ChildProcess => {
    if (isWindows) {
        return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].join(' ')], {
            env: {
                ...process.env,
                ...env,
            },
            stdio: 'inherit',
            windowsHide: true,
        })
    }

    return spawn(command, args, {
        env: {
            ...process.env,
            ...env,
        },
        stdio: 'inherit',
    })
}

const waitForManifest = async (): Promise<void> => {
    const deadline = Date.now() + 30_000

    while (Date.now() < deadline) {
        const ready = await new Promise<boolean>(resolve => {
            const request = http.get(manifestUrl, response => {
                response.resume()
                resolve(response.statusCode === 200)
            })
            request.on('error', () => resolve(false))
            request.setTimeout(1000, () => {
                request.destroy()
                resolve(false)
            })
        })

        if (ready) {
            return
        }

        await new Promise(resolve => setTimeout(resolve, 500))
    }

    throw new Error(`Remote renderer manifest did not become ready: ${manifestUrl}`)
}

const stopProcess = (child: ChildProcess | null): void => {
    if (!child || child.killed) {
        return
    }

    if (isWindows && child.pid) {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        return
    }

    child.kill('SIGTERM')
}

async function main(): Promise<void> {
    let rendererProcess: ChildProcess | null = null
    let mainProcess: ChildProcess | null = null

    const shutdown = (): void => {
        stopProcess(mainProcess)
        stopProcess(rendererProcess)
    }

    process.once('SIGINT', () => {
        shutdown()
        process.exit(130)
    })
    process.once('SIGTERM', () => {
        shutdown()
        process.exit(143)
    })

    rendererProcess = runCommand('corepack', ['yarn', 'dev:renderer'])
    rendererProcess.once('exit', code => {
        if (!mainProcess) {
            process.exit(code ?? 1)
        }
    })

    try {
        await waitForManifest()
    } catch (error) {
        shutdown()
        throw error
    }

    mainProcess = runCommand('corepack', ['yarn', 'dev:native'], {
        PULSESYNC_ALLOW_SECOND_INSTANCE: '1',
        PULSESYNC_REMOTE_RENDERER_MANIFEST_URL: manifestUrl,
    })

    mainProcess.once('exit', code => {
        stopProcess(rendererProcess)
        process.exit(code ?? 0)
    })
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    await main()
}
