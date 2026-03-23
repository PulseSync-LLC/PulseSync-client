import { defineConfig } from 'vite'
import path from 'path'
import packageJson from './package.json'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'

    return {
        build: {
            sourcemap: isDevMode,
            target: 'node24.14',
            outDir: path.resolve(__dirname, `.vite/main`),
            rolldownOptions: {
                external: ['electron', 'original-fs'],
                output: {
                    format: 'cjs',
                    preserveModules: false,
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
    }
})
