import { defineConfig, type UserConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode, forgeConfigSelf }: any): UserConfig => {
    const isDevMode = mode === 'development'
    const entry = forgeConfigSelf?.entry ?? 'src/main/modules/mod/network/artifactWorker.ts'

    return {
        ssr: {
            noExternal: ['adm-zip', 'zstd-codec'],
        },
        build: {
            sourcemap: isDevMode,
            target: 'node24.14',
            outDir: path.resolve(__dirname, '.vite/worker'),
            ssr: entry,
            rolldownOptions: {
                external: ['original-fs'],
                output: {
                    format: 'cjs' as const,
                    entryFileNames: 'artifactWorker.cjs',
                    preserveModules: false,
                },
            },
        },
    }
})
