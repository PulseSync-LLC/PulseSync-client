import { defineConfig, type UserConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode, forgeConfigSelf }: any): UserConfig => {
    const isDevMode = mode === 'development'
    const sourceMapMode = isDevMode ? true : process.env.GLITCHTIP_SOURCEMAPS === '1' ? 'hidden' : false
    const entry = forgeConfigSelf?.entry ?? 'src/main/modules/mod/network/artifactWorker.ts'

    return {
        build: {
            sourcemap: sourceMapMode,
            target: 'node24.17',
            outDir: path.resolve(__dirname, '.vite/worker'),
            ssr: entry,
            rolldownOptions: {
                output: {
                    format: 'cjs' as const,
                    entryFileNames: 'artifactWorker.cjs',
                    preserveModules: false,
                },
            },
        },
        define: {
            __non_vite_require__: 'require',
        },
    }
})
