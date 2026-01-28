import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
    const isDevMode = mode === 'development'
    const shouldUploadToSentry = process.env.SENTRY_UPLOAD === 'true'
    return {
        define: {
            'import.meta.env.DEV': JSON.stringify(isDevMode),
            'import.meta.env.PROD': JSON.stringify(!isDevMode),
        },
        build: {
            sourcemap: isDevMode || shouldUploadToSentry,
        },
    }
})
