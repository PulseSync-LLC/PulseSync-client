import { defineConfig } from 'vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'
import packageJson from './package.json'
import { createDeleteSourceMapsPlugin } from './vite/deleteSourceMapsPlugin'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'
    const shouldUploadToSentry = process.env.SENTRY_UPLOAD === 'true'
    const isProd = mode === 'production' && shouldUploadToSentry

    return {
        define: {
            'import.meta.env.DEV': JSON.stringify(isDevMode),
            'import.meta.env.PROD': JSON.stringify(!isDevMode),
        },
        resolve: {
            alias: {
                '@common': path.resolve(__dirname, 'src/common'),
            },
        },
        build: {
            sourcemap: isDevMode || shouldUploadToSentry,
            outDir: path.resolve(__dirname, `.vite/main`),
        },
        plugins: [
            ...(isProd
                ? [
                      sentryVitePlugin({
                          org: 'pulsesync',
                          project: 'electron',
                          authToken: process.env.SENTRY_KEY,
                          release: {
                              name: `pulsesync@${packageJson.version}`,
                          },
                          sourcemaps: {
                              ignore: ['**/node_modules/**'],
                              filesToDeleteAfterUpload: ['**/*.map'],
                          },
                          errorHandler: err => {
                              console.warn(err)
                          },
                      }),
                      createDeleteSourceMapsPlugin(path.resolve(__dirname, '.vite/main')),
                  ]
                : shouldUploadToSentry
                  ? [createDeleteSourceMapsPlugin('.vite')]
                  : []),
        ],
    }
})
