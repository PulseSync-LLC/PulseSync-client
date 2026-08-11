import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer, type Plugin } from 'vite'
import { DESKTOP_API_VERSION } from '../src/common/desktopApi/version.js'
import { remoteRendererDevConfig } from './dev-remote-config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const remoteRendererCacheDir = path.resolve(projectRoot, 'node_modules/.vite-remote-renderer')
const localizationPathPrefix = '/locales/'

const { host, port, rendererUrl, manifestPath, manifestUrl } = remoteRendererDevConfig

fs.rmSync(remoteRendererCacheDir, { force: true, recursive: true })

let rendererReady = false
let rendererReadyError: string | null = null

const manifestPlugin = (): Plugin => ({
    name: 'pulsesync-remote-renderer-manifest',
    configureServer(server: ViteDevServer) {
        server.middlewares.use((_request, response, next) => {
            response.setHeader('Cache-Control', 'no-store')
            next()
        })
        server.middlewares.use(manifestPath, (_request, response) => {
            if (!rendererReady) {
                response.statusCode = 503
                response.setHeader('Content-Type', 'application/json; charset=utf-8')
                response.setHeader('Cache-Control', 'no-store')
                response.end(
                    JSON.stringify({
                        error: rendererReadyError || 'Remote renderer is warming up',
                    }),
                )
                return
            }

            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.setHeader('Cache-Control', 'no-store')
            response.end(
                JSON.stringify({
                    buildNumber: '0',
                    url: rendererUrl,
                    localizationUrl: new URL('/locales/', rendererUrl).toString(),
                    requiresDesktopApi: `^${DESKTOP_API_VERSION}`,
                }),
            )
        })
        server.middlewares.use(localizationPathPrefix, (request, response) => {
            const match = request.url?.match(/^\/?(en|ru)\/(main|renderer)\.json(?:\?.*)?$/u)
            if (!match) {
                response.statusCode = 404
                response.end()
                return
            }
            const sourcePath = path.join(projectRoot, 'src', 'locales', match[1], `${match[2]}.json`)
            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.setHeader('Cache-Control', 'no-store')
            response.end(fs.readFileSync(sourcePath))
        })
    },
})

type DevServerWithClientDeps = ViteDevServer & {
    environments: {
        client: {
            depsOptimizer?: {
                scanProcessing?: Promise<void>
                metadata: {
                    depInfoList: Array<{
                        processing?: Promise<void>
                    }>
                }
            }
        }
    }
}

const waitForDependencyOptimizer = async (server: ViteDevServer): Promise<void> => {
    const optimizer = (server as DevServerWithClientDeps).environments.client.depsOptimizer
    if (!optimizer) {
        return
    }

    await optimizer.scanProcessing

    let observedDepCount = -1
    while (observedDepCount !== optimizer.metadata.depInfoList.length) {
        observedDepCount = optimizer.metadata.depInfoList.length
        const pending = optimizer.metadata.depInfoList.map(info => info.processing).filter((promise): promise is Promise<void> => Boolean(promise))
        await Promise.all(pending)
    }
}

const warmupRenderer = async (server: ViteDevServer): Promise<void> => {
    const rendererEntry = '/src/renderer/index.ts'
    await server.transformRequest(rendererEntry)
    await server.waitForRequestsIdle(rendererEntry)
    await waitForDependencyOptimizer(server)
}

const server = await createServer({
    cacheDir: remoteRendererCacheDir,
    configFile: path.resolve(projectRoot, 'vite.renderer.config.ts'),
    mode: 'development',
    server: {
        host,
        port,
        strictPort: true,
    },
    optimizeDeps: {
        entries: ['src/renderer/index.html', 'src/renderer/**/*.{ts,tsx}', 'src/common/**/*.{ts,tsx}'],
        ignoreOutdatedRequests: true,
    },
    plugins: [manifestPlugin()],
})

await server.listen()

try {
    await warmupRenderer(server)
    rendererReady = true
} catch (error) {
    rendererReadyError = error instanceof Error ? error.message : String(error)
    throw error
}

console.log(`PulseSync remote renderer: ${rendererUrl}`)
console.log(`PulseSync remote manifest: ${manifestUrl}`)
console.log(`Main client env: PULSESYNC_REMOTE_RENDERER_MANIFEST_URL=${manifestUrl}`)

const close = async (): Promise<void> => {
    await server.close()
    process.exit(0)
}

process.on('SIGINT', () => {
    void close()
})
process.on('SIGTERM', () => {
    void close()
})
