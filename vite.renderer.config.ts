import { fileURLToPath } from 'node:url'

import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string
    buildInfo?: { BRANCH?: string }
}
const rendererHtmlEntries: Record<string, string> = {
    main_window: 'src/renderer/index.html',
    settings_window: 'src/renderer/settings.html',
    preloader: 'src/renderer/preloader.html',
}

export default defineConfig(({ mode, forgeConfigSelf }: any) => {
    const isRemoteRendererBuild = process.env.PULSESYNC_REMOTE_RENDERER_BUILD === '1'
    const buildDist = isRemoteRendererBuild ? 'remote' : process.env.PULSESYNC_BUILD_DIST || `${process.platform}-${process.arch}`
    const name = isRemoteRendererBuild ? 'main_window' : (forgeConfigSelf?.name ?? 'main_window')
    const htmlEntry = rendererHtmlEntries[name]
    if (!htmlEntry) {
        throw new Error(`Unknown renderer entry: ${name}`)
    }

    const isDevMode = mode === 'development'
    const sourceMapMode = isDevMode ? true : process.env.GLITCHTIP_SOURCEMAPS === '1' ? 'hidden' : false
    const remoteRendererOutDir = process.env.PULSESYNC_REMOTE_RENDERER_OUT_DIR
    const remoteRendererStaticAssetsDir = process.env.PULSESYNC_REMOTE_RENDERER_STATIC_ASSETS_DIR
    const remoteRendererBase = process.env.PULSESYNC_REMOTE_RENDERER_BASE || '/app/'
    const rendererBuildNumber = process.env.PULSESYNC_REMOTE_RENDERER_BUILD_NUMBER?.trim() || '0'
    const rendererOutDir = isRemoteRendererBuild
        ? path.resolve(__dirname, remoteRendererOutDir || 'out/remote-renderer/versions/dev')
        : path.resolve(__dirname, `.vite/renderer/${name}`)
    const rendererAssetsDir = isRemoteRendererBuild
        ? path.resolve(__dirname, remoteRendererStaticAssetsDir || 'out/remote-renderer/assets')
        : path.resolve(__dirname, '.vite/renderer/assets')
    const staticAssetsDir = path.resolve(__dirname, 'static/assets')
    const publicDir: string | false = isDevMode ? path.resolve(__dirname, 'static') : false

    return {
        root: __dirname,
        base: isDevMode ? '/' : isRemoteRendererBuild ? remoteRendererBase : './',
        publicDir,
        define: {
            PULSESYNC_VERSION: JSON.stringify(packageJson.version),
            PULSESYNC_BRANCH: JSON.stringify(packageJson.buildInfo?.BRANCH ?? 'unknown'),
            PULSESYNC_DIST: JSON.stringify(buildDist),
            PULSESYNC_RENDERER_BUILD_NUMBER: JSON.stringify(rendererBuildNumber),
            'import.meta.env.DEV': JSON.stringify(isDevMode),
            'import.meta.env.PROD': JSON.stringify(!isDevMode),
        },
        server: {
            fs: {
                allow: [__dirname],
                strict: false,
            },
            middlewareMode: false,
            cors: true,
        },
        build: {
            sourcemap: sourceMapMode,
            target: 'chrome150',
            outDir: rendererOutDir,
            assetsDir: isRemoteRendererBuild ? 'assets' : '../assets',
            emptyOutDir: true,
            rolldownOptions: {
                input: isRemoteRendererBuild ? { index: path.resolve(__dirname, htmlEntry) } : path.resolve(__dirname, htmlEntry),
                output: {
                    entryFileNames: isRemoteRendererBuild ? 'assets/[hash:16].js' : 'renderer.js',
                    chunkFileNames: isRemoteRendererBuild ? 'assets/[hash:16].js' : '[name].js',
                    assetFileNames: isRemoteRendererBuild ? 'assets/[hash:16][extname]' : '[name].[ext]',
                    hashCharacters: 'hex',
                    codeSplitting: {
                        groups: [
                            {
                                name: moduleId => {
                                    if (moduleId.includes('node_modules')) {
                                        return 'vendor'
                                    }
                                    return null
                                },
                                entriesAware: true,
                            },
                        ],
                    },
                },
            },
        },
        css: {
            modules: {
                generateScopedName: isDevMode ? '[name]__[local]' : '[name]__[local]__[hash:base64:6]',
            },
        },
        plugins: [
            svgr({
                include: 'src/**/*.svg',
            }),
            react({}),
            babel({
                presets: [reactCompilerPreset()],
            } as Parameters<typeof babel>[0]),
            ...(!isDevMode
                ? [
                      {
                          name: 'copy-shared-static-assets',
                          writeBundle() {
                              if (!fs.existsSync(staticAssetsDir)) {
                                  return
                              }
                              fs.mkdirSync(rendererAssetsDir, { recursive: true })
                              for (const entry of fs.readdirSync(staticAssetsDir)) {
                                  const source = path.join(staticAssetsDir, entry)
                                  const destination = path.join(rendererAssetsDir, entry)
                                  fs.cpSync(source, destination, { force: true, recursive: true })
                              }
                          },
                      },
                  ]
                : []),
        ],
        resolve: {
            preserveSymlinks: true,
            alias: {
                '@': path.resolve(__dirname, 'static'),
                '@common': path.resolve(__dirname, 'src/common'),
                '@app': path.resolve(__dirname, 'src/renderer/app'),
                '@pages': path.resolve(__dirname, 'src/renderer/pages'),
                '@widgets': path.resolve(__dirname, 'src/renderer/widgets'),
                '@features': path.resolve(__dirname, 'src/renderer/features'),
                '@entities': path.resolve(__dirname, 'src/renderer/entities'),
                '@shared': path.resolve(__dirname, 'src/renderer/shared'),
                path: 'path-browserify',
                '/assets': path.resolve(__dirname, 'static/assets'),
            },
        },
    }
})
