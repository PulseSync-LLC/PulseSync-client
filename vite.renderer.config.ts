import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { defineConfig } from 'vite'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'fs'
import packageJson from './package.json'
import config from './config.json'
import nodeExternals from 'rollup-plugin-node-externals'

const rendererHtmlEntries: Record<string, string> = {
    main_window: 'src/renderer/index.html',
    settings_window: 'src/renderer/settings.html',
    preloader: 'src/renderer/preloader.html',
}

export default defineConfig(({ mode, forgeConfigSelf }: any) => {
    const name = forgeConfigSelf?.name ?? 'main_window'
    const htmlEntry = rendererHtmlEntries[name]
    if (!htmlEntry) {
        throw new Error(`Unknown renderer entry: ${name}`)
    }

    const isDevMode = mode === 'development'
    const isDevSourceMapMode = process.env.NODE_ENV === 'development'
    const shouldUploadToSentry = process.env.SENTRY_UPLOAD === 'true'
    const isProd = mode === 'production' && shouldUploadToSentry
    const sharedAssetsDir = path.resolve(__dirname, '.vite/renderer/assets')
    const staticAssetsDir = path.resolve(__dirname, 'static/assets')
    const publicDir: string | false = isDevMode ? path.resolve(__dirname, 'static') : false

    return {
        root: __dirname,
        base: isDevMode ? '/' : '../',
        publicDir,
        server: {
            fs: {
                allow: [__dirname],
                strict: false,
            },
            middlewareMode: false,
            cors: true,
        },
        build: {
            sourcemap: isDevSourceMapMode,
            outDir: path.resolve(__dirname, `.vite/renderer/${name}`),
            assetsDir: 'dist',
            emptyOutDir: true,
            rollupOptions: {
                input: path.resolve(__dirname, htmlEntry),
                output: {
                    entryFileNames: '[name].js',
                    chunkFileNames: '[name].js',
                    assetFileNames: '[name].[ext]',
                },
            },
        },
        plugins: [
            {
                name: 'html-preprocess',
                enforce: 'pre',
                resolveId(id) {
                    if (id.startsWith('/src/main/')) {
                        return path.resolve(__dirname, id.slice(1))
                    }
                },
            },
            nodeExternals(),
            nodePolyfills(),
            svgr({
                include: 'src/**/*.svg',
            }),
            react(),
            ...(!isDevMode
                ? [
                      {
                          name: 'copy-shared-static-assets',
                          writeBundle() {
                              if (!fs.existsSync(staticAssetsDir)) {
                                  return
                              }
                              fs.mkdirSync(sharedAssetsDir, { recursive: true })
                              for (const entry of fs.readdirSync(staticAssetsDir)) {
                                  const source = path.join(staticAssetsDir, entry)
                                  const destination = path.join(sharedAssetsDir, entry)
                                  fs.cpSync(source, destination, { force: true, recursive: true })
                              }
                          },
                      },
                  ]
                : []),
            ...(isProd
                ? [
                      sentryVitePlugin({
                          org: 'pulsesync',
                          project: 'electron',
                          authToken: (config as any).SENTRY_KEY,
                          release: {
                              name: `pulsesync@${packageJson.version}`,
                          },
                          sourcemaps: {
                              ignore: ['**/node_modules/**'],
                              filesToDeleteAfterUpload: ['**/*.map'],
                          },
                          reactComponentAnnotation: {
                              enabled: true,
                          },
                          errorHandler: err => {
                              console.warn(err)
                          },
                      }),
                  ]
                : []),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'static'),
                '/assets': path.resolve(__dirname, 'static/assets'),
            },
        },
    }
})
