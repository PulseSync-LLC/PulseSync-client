import { defineConfig } from 'vite'
import path from 'path'
import packageJson from './package.json'
import nodeExternals from 'rollup-plugin-node-externals'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'

    return {
        build: {
            sourcemap: isDevMode,
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
        ],
    }
})
