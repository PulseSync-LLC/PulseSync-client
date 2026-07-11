import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'node:url'
import { prepareGlitchTipSourceMaps } from './scripts/glitchtip-sourcemaps.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shouldBundleMainRenderer =
    process.env.PULSESYNC_BUNDLE_RENDERER === '1' && process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF?.startsWith('refs/tags/')

const DESKTOP_CORE_MODULE_NAME = 'desktopCore'
const desktopCorePackage = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'packages', 'desktop-core', 'package.json'), 'utf8')) as {
    name: string
    private: boolean
    version: string
    main: string
}

async function packageDesktopCore(buildPath: string): Promise<void> {
    const mainOutputDir = path.join(buildPath, '.vite', 'main')
    const coreFiles = [
        { source: 'desktopCore.cjs', target: 'index.cjs' },
        { source: 'mainWindowPreload.cjs', target: 'mainWindowPreload.cjs' },
    ]
    const resourcesPath = path.resolve(buildPath, '..')
    const packagedAppRoot = path.resolve(resourcesPath, '..')
    const modulesRoot = path.join(packagedAppRoot, 'modules')
    const coreModuleRoot = path.join(modulesRoot, `${DESKTOP_CORE_MODULE_NAME}-${desktopCorePackage.version}`)
    const coreModuleDir = path.join(coreModuleRoot, DESKTOP_CORE_MODULE_NAME)

    if (fs.existsSync(modulesRoot)) {
        for (const name of fs.readdirSync(modulesRoot)) {
            if (name === DESKTOP_CORE_MODULE_NAME || name.startsWith(`${DESKTOP_CORE_MODULE_NAME}-`)) {
                fs.rmSync(path.join(modulesRoot, name), { force: true, recursive: true })
            }
        }
    }
    fs.mkdirSync(coreModuleDir, { recursive: true })

    for (const file of coreFiles) {
        const sourcePath = path.join(mainOutputDir, file.source)
        if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            throw new Error(`Desktop core build output was not found: ${sourcePath}`)
        }
        fs.copyFileSync(sourcePath, path.join(coreModuleDir, file.target))
    }

    fs.writeFileSync(path.join(coreModuleDir, 'package.json'), `${JSON.stringify(desktopCorePackage, null, 4)}\n`, 'utf8')

    for (const file of coreFiles) {
        fs.rmSync(path.join(mainOutputDir, file.source), { force: true })
    }
}

const forgeConfig: ForgeConfig = {
    packagerConfig: {
        icon: process.platform === 'linux' ? './icons/icon.png' : './icons/icon',
        name: 'PulseSync',
        executableName: process.platform === 'linux' ? 'pulsesync' : 'PulseSync',
        appCopyright: `Copyright (C) ${new Date().getFullYear()} Матвиенко Артём Евгеньевич`,
        asar: true,
        win32metadata: {
            CompanyName: 'Матвиенко Артём Евгеньевич',
        },
        appBundleId: 'pulsesync.app',
        extendInfo: 'Info.plist',
    },
    rebuildConfig: {
        ignoreModules: ['@parcel/watcher', 'bufferutil', 'utf-8-validate'],
    },
    plugins: [
        new VitePlugin({
            build: [
                {
                    entry: 'src/bootstrap.ts',
                    config: 'vite.main.config.ts',
                },
                {
                    entry: 'src/desktopCore.ts',
                    config: 'vite.main.config.ts',
                },
                {
                    entry: 'src/main/mainWindowPreload.ts',
                    config: 'vite.preload.config.ts',
                    target: 'preload',
                },
                {
                    entry: 'src/main/bootstrapWindowPreload.ts',
                    config: 'vite.preload.config.ts',
                    target: 'preload',
                },
                {
                    entry: 'src/main/modules/mod/network/artifactWorker.ts',
                    config: 'vite.worker.config.ts',
                },
            ],
            renderer: [
                ...(shouldBundleMainRenderer
                    ? [
                          {
                              name: 'main_window',
                              config: 'vite.renderer.config.ts',
                          },
                      ]
                    : []),
                {
                    name: 'preloader',
                    config: 'vite.renderer.config.ts',
                },
            ],
        }),
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: true,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
            [FuseV1Options.EnableNodeCliInspectArguments]: true,
        }),
    ],
    hooks: {
        packageAfterPrune: async (_forgeConfig, buildPath) => {
            const packageJsonPath = path.resolve(buildPath, 'package.json')
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
            Object.keys(pkg).forEach(key => {
                switch (key) {
                    case 'name':
                    case 'version':
                    case 'main':
                    case 'author':
                    case 'devDependencies':
                    case 'homepage':
                    case 'buildInfo':
                        break
                    default:
                        delete pkg[key]
                }
            })
            fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, '\t'))
        },
        packageAfterCopy: async (_forgeConfig, buildPath, electronVersion, platform, arch) => {
            prepareGlitchTipSourceMaps(buildPath, platform, arch)
            await packageDesktopCore(buildPath)
            fs.rmSync(path.join(buildPath, '.vite', 'worker'), { force: true, recursive: true })
            if (!shouldBundleMainRenderer) {
                fs.rmSync(path.join(buildPath, '.vite', 'renderer', 'assets'), { force: true, recursive: true })
            }
            const resourcesPath = path.resolve(buildPath, '..')
            const iconSource = path.resolve(__dirname, 'static', 'assets', 'icon')
            const iconDestination = path.join(resourcesPath, 'assets', 'icon')
            fs.mkdirSync(iconDestination, { recursive: true })
            fs.cpSync(iconSource, iconDestination, { recursive: true })
            const pextIconSource = path.resolve(__dirname, 'icons', 'pext')
            const pextIconDestination = path.join(resourcesPath, 'assets', 'pext')
            fs.mkdirSync(pextIconDestination, { recursive: true })
            fs.cpSync(pextIconSource, pextIconDestination, { recursive: true })
            console.log(`Built app ${platform}-${arch} with Electron ${electronVersion}`)
        },
    },
}

export default forgeConfig
