import { defineConfig, type UserConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string
    buildInfo?: { BRANCH?: string }
}

export default defineConfig(({ mode, forgeConfigSelf }: any): UserConfig => {
    const isDevMode = mode === 'development'
    const entry = forgeConfigSelf?.entry ?? 'src/index.ts'

    return {
        build: {
            sourcemap: isDevMode,
            target: 'node24.14',
            outDir: path.resolve(__dirname, `.vite/main`),
            lib: {
                entry,
                fileName: () => '[name].cjs',
                formats: ['cjs'],
            },
            rolldownOptions: {
                external: ['electron', 'original-fs'],
                output: {
                    format: 'cjs' as const,
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
