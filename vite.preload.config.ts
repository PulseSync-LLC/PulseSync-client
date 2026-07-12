import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
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
const nodeExternals = [...new Set([...builtinModules, ...builtinModules.map(moduleName => `node:${moduleName}`)])]

function resolveBuildCommit(): string {
    if (packageJson.buildInfo?.BRANCH) {
        return packageJson.buildInfo.BRANCH
    }

    try {
        return execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim()
    } catch {
        return 'unknown'
    }
}

export default defineConfig(({ mode, forgeConfigSelf }: any) => {
    const isDevMode = mode === 'development'
    const sourceMapMode = isDevMode ? true : process.env.GLITCHTIP_SOURCEMAPS === '1' ? 'hidden' : false
    const entry = forgeConfigSelf?.entry ?? 'src/main/mainWindowPreload.ts'
    const bundleVersion = entry.endsWith('bootstrapWindowPreload.ts') ? packageJson.version : desktopCorePackageJson.version

    return {
        plugins: [
            {
                name: 'forge-vite8-preload-compat',
                config(config) {
                    const output = config.build?.rolldownOptions?.output
                    if (output && !Array.isArray(output)) {
                        delete (output as Record<string, unknown>)['inlineDynamicImports']
                    }
                },
            },
        ],
        define: {
            PULSESYNC_VERSION: JSON.stringify(bundleVersion),
            PULSESYNC_HOST_VERSION: JSON.stringify(packageJson.version),
            PULSESYNC_CORE_VERSION: JSON.stringify(desktopCorePackageJson.version),
            PULSESYNC_BRANCH: JSON.stringify(resolveBuildCommit()),
            'import.meta.env.DEV': JSON.stringify(isDevMode),
            'import.meta.env.PROD': JSON.stringify(!isDevMode),
        },
        resolve: {
            alias: {
                '@common': path.resolve(__dirname, 'src/common'),
            },
        },
        build: {
            sourcemap: sourceMapMode,
            target: 'node24.17',
            outDir: path.resolve(__dirname, `.vite/main`),
            rolldownOptions: {
                external: ['electron', 'original-fs', ...nodeExternals],
                input: entry,
                output: {
                    codeSplitting: false,
                    entryFileNames: '[name].cjs',
                    chunkFileNames: '[name].cjs',
                    format: 'cjs',
                },
            },
        },
    }
})
