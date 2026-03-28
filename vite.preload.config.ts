import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode, forgeConfigSelf }: any) => {
    const isDevMode = mode === 'development'
    const entry = forgeConfigSelf?.entry ?? 'src/main/mainWindowPreload.ts'

    return {
        plugins: [
            {
                name: 'forge-vite8-preload-compat',
                config(config) {
                    const output = config.build?.rollupOptions?.output
                    if (output && !Array.isArray(output)) {
                        delete output.inlineDynamicImports
                    }
                },
            },
        ],
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
            sourcemap: isDevMode,
            target: 'node24.14',
            outDir: path.resolve(__dirname, `.vite/main`),
            rolldownOptions: {
                input: entry,
                output: {
                    codeSplitting: false,
                    entryFileNames: '[name].cjs',
                    chunkFileNames: '[name].cjs',
                },
            },
        },
    }
})
