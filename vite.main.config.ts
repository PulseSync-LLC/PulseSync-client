import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import path from 'path'
import packageJson from './package.json'
import nodeExternals from 'rollup-plugin-node-externals'
import { createDeleteSourceMapsPlugin } from './vite/deleteSourceMapsPlugin'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'
    const shouldUploadToSentry = process.env.SENTRY_UPLOAD === 'true'
    const isProd = mode === 'production' && shouldUploadToSentry

    return {
        build: {
            sourcemap: isDevMode || shouldUploadToSentry,
            outDir: path.resolve(__dirname, `.vite/main`),
            rollupOptions: {
                external: ['electron', 'original-fs'],
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
            'import.meta.env.DEV': JSON.stringify(isDevMode),
            'import.meta.env.PROD': JSON.stringify(!isDevMode),
            __non_vite_require__: 'require',
        },

        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'static'),
                '@common': path.resolve(__dirname, 'src/common'),
            },
        },

        plugins: [
            nodeExternals({
                builtins: true,
                deps: false,
                peerDeps: false,
                optDeps: false,
                devDeps: false,
            }),
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
                          reactComponentAnnotation: { enabled: true },
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
