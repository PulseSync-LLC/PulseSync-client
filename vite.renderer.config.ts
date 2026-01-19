import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { defineConfig } from 'vite'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
import config from './config.json'

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

    const isDevMode = process.env.NODE_ENV === 'development'
    const shouldUploadToSentry = process.env.SENTRY_UPLOAD === 'true'
    const isProd = mode === 'production' && shouldUploadToSentry

    return {
        root: __dirname,
        base: isDevMode ? '/' : './',
        publicDir: path.resolve(__dirname, 'static'),
        server: {
            fs: {
                allow: [__dirname],
                strict: false,
            },
            middlewareMode: false,
            cors: true,
        },
        build: {
            sourcemap: !isDevMode,
            outDir: path.resolve(__dirname, `.vite/renderer/${name}`),
            rollupOptions: {
                input: path.resolve(__dirname, htmlEntry),
            },
        },
        plugins: [
            svgr({
                include: 'src/**/*.svg',
            }),
            react(),
            nodePolyfills({ protocolImports: true }),
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
            },
        },
    }
})
