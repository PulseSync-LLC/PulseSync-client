import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'

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
            sourcemap: isDevMode,
            outDir: path.resolve(__dirname, `.vite/main`),
        },
        plugins: [],
    }
})
