import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'

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
                output: {
                    codeSplitting: false,
                },
            },
        },
    }
})
