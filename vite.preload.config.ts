import { defineConfig } from 'vite'

export default defineConfig(() => {
    const isDevMode = process.env.NODE_ENV === 'development'
    return {
        build: {
            sourcemap: isDevMode,
        },
    }
})
