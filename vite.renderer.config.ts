import react from '@vitejs/plugin-react-swc'
import svgr from 'vite-plugin-svgr'
import { defineConfig } from 'vite'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import fs from 'fs'

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
    const rendererAssetsDir = path.resolve(__dirname, '.vite/renderer/assets')
    const staticAssetsDir = path.resolve(__dirname, 'static/assets')
    const publicDir: string | false = isDevMode ? path.resolve(__dirname, 'static') : false

    return {
        root: __dirname,
        base: isDevMode ? '/' : './',
        publicDir,
        define: {
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
            sourcemap: isDevSourceMapMode,
            outDir: path.resolve(__dirname, `.vite/renderer/${name}`),
            assetsDir: '../assets',
            emptyOutDir: true,
            rollupOptions: {
                input: path.resolve(__dirname, htmlEntry),
                output: {
                    entryFileNames: 'renderer.js',
                    chunkFileNames: '[name].js',
                    assetFileNames: '[name].[ext]',
                    manualChunks: id => {
                        if (id.includes('node_modules')) {
                            return 'vendor'
                        }
                        return undefined
                    },
                },
            },
        },
        plugins: [
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
            alias: {
                '@': path.resolve(__dirname, 'static'),
                '@common': path.resolve(__dirname, 'src/common'),
                '/assets': path.resolve(__dirname, 'static/assets'),
            },
        },
    }
})
