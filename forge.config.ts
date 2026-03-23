import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import path from 'path'
import fs from 'fs'

const collectNativeNodeFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return []

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            files.push(...collectNativeNodeFiles(fullPath))
            continue
        }
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.node') {
            files.push(fullPath)
        }
    }

    return files
}

const copyNativeModules = (resourcesPath: string): void => {
    const nativeModulesRoot = path.resolve(__dirname, 'nativeModules')
    const modulesDestination = path.join(resourcesPath, 'modules')

    if (!fs.existsSync(nativeModulesRoot)) return

    fs.mkdirSync(modulesDestination, { recursive: true })

    for (const addonName of fs.readdirSync(nativeModulesRoot)) {
        const addonPath = path.join(nativeModulesRoot, addonName)
        if (!fs.statSync(addonPath).isDirectory()) continue

        const nodeFiles = collectNativeNodeFiles(addonPath)
        if (nodeFiles.length === 0) continue

        const addonDestination = path.join(modulesDestination, addonName)
        fs.mkdirSync(addonDestination, { recursive: true })

        for (const nodeFile of nodeFiles) {
            fs.copyFileSync(nodeFile, path.join(addonDestination, path.basename(nodeFile)))
        }
    }
}

const forgeConfig: ForgeConfig = {
    packagerConfig: {
        icon: process.platform === 'linux' ? './icons/icon.png' : './icons/icon',
        name: 'PulseSync',
        executableName: process.platform === 'linux' ? 'pulsesync' : 'PulseSync',
        appCopyright: `Copyright (C) ${new Date().getFullYear()} ИП «Деднев Григорий Дмитриевич»`,
        asar: {
            unpack: '**/.vite/renderer/**/static/assets/icon/**',
        },
        win32metadata: {
            CompanyName: 'ИП «Деднев Григорий Дмитриевич»',
        },
        appBundleId: 'pulsesync.app',
        extendInfo: 'Info.plist',
        extraResource: ['./app-update.yml'],
    },
    rebuildConfig: {
        ignoreModules: ['@parcel/watcher', 'bufferutil', 'utf-8-validate'],
    },
    plugins: [
        new VitePlugin({
            build: [
                {
                    entry: 'src/index.ts',
                    config: 'vite.main.config.ts',
                },
                {
                    entry: 'src/main/mainWindowPreload.ts',
                    config: 'vite.preload.config.ts',
                    target: 'preload',
                },
            ],
            renderer: [
                {
                    name: 'preloader',
                    config: 'vite.renderer.config.ts',
                },
                {
                    name: 'main_window',
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
            const resourcesPath = path.resolve(buildPath, '..')
            const iconSource = path.resolve(__dirname, 'static', 'assets', 'icon')
            const iconDestination = path.join(resourcesPath, 'assets', 'icon')
            fs.mkdirSync(iconDestination, { recursive: true })
            fs.cpSync(iconSource, iconDestination, { recursive: true })
            const pextIconSource = path.resolve(__dirname, 'icons', 'pext')
            const pextIconDestination = path.join(resourcesPath, 'assets', 'pext')
            fs.mkdirSync(pextIconDestination, { recursive: true })
            fs.cpSync(pextIconSource, pextIconDestination, { recursive: true })
            copyNativeModules(resourcesPath)
            console.log(`Built app ${platform}-${arch} with Electron ${electronVersion}`)
        },
    },
}

export default forgeConfig
