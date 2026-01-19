import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import path from 'path'
import packageJson from './package.json'
import config from './config.json'

export default defineConfig(({ mode }) => {
    const isDevMode = process.env.NODE_ENV === 'development'
    const shouldUploadToSentry = process.env.SENTRY_UPLOAD === 'true'
    const isProd = mode === 'production' && shouldUploadToSentry

    return {
        build: {
            sourcemap: !isDevMode,
            rollupOptions: {
                external: [
                    'original-fs',
                    'bufferutil',
                    'utf-8-validate',
                    'cors-anywhere',
                    'electron',
                    'electron-store',
                    'electron-updater',
                    'log4js',
                ],
                output: {
                    format: 'cjs',
                    preserveModules: false,
                    interop: 'auto',
                },
            },
        },
        define: {
            'process.env.BRANCH': JSON.stringify((packageJson as any).buildInfo?.BRANCH),
            'process.env.VERSION': JSON.stringify(packageJson.version),
            '__non_vite_require__': 'require',
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'static'),
            },
        },
        plugins: [
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
    }
})
