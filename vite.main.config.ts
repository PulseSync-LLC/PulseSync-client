import { defineConfig, type UserConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string
    buildInfo?: { BRANCH?: string }
}
const desktopCorePackageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'packages', 'desktop-core', 'package.json'), 'utf-8')) as {
    version: string
}
const buildDist = process.env.PULSESYNC_BUILD_DIST || `${process.platform}-${process.arch}`
const nodeExternals = [...new Set([...builtinModules, ...builtinModules.map(moduleName => `node:${moduleName}`)])]

export default defineConfig(({ mode, forgeConfigSelf }: any): UserConfig => {
    const isDevMode = mode === 'development'
    const sourceMapMode = isDevMode ? true : process.env.GLITCHTIP_SOURCEMAPS === '1' ? 'hidden' : false
    const entry = forgeConfigSelf?.entry ?? 'src/index.ts'
    const bundleVersion = entry === 'src/bootstrap.ts' ? packageJson.version : desktopCorePackageJson.version

    return {
        build: {
            sourcemap: sourceMapMode,
            target: 'node24.17',
            outDir: path.resolve(__dirname, `.vite/main`),
            emptyOutDir: false,
            lib: {
                entry,
                fileName: () => '[name].cjs',
                formats: ['cjs'],
            },
            rolldownOptions: {
                external: ['electron', 'original-fs', ...nodeExternals],
                output: {
                    format: 'cjs' as const,
                    preserveModules: false,
                },
            },
        },

        define: {
            PULSESYNC_VERSION: JSON.stringify(bundleVersion),
            PULSESYNC_HOST_VERSION: JSON.stringify(packageJson.version),
            PULSESYNC_CORE_VERSION: JSON.stringify(desktopCorePackageJson.version),
            PULSESYNC_BRANCH: JSON.stringify(packageJson.buildInfo?.BRANCH ?? 'unknown'),
            PULSESYNC_DIST: JSON.stringify(buildDist),
            'process.env.BRANCH': JSON.stringify((packageJson as any).buildInfo?.BRANCH),
            'process.env.VERSION': JSON.stringify(bundleVersion),
            'import.meta.env.DEV': JSON.stringify(isDevMode),
            'import.meta.env.PROD': JSON.stringify(!isDevMode),
            __non_vite_require__: 'require',
        },

        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'static'),
                '@common': path.resolve(__dirname, 'src/common'),
            },
            conditions: ['node'],
            mainFields: ['module', 'jsnext:main', 'jsnext'],
        },
    }
})
