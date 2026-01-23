import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import path from 'path'
import fs from 'fs'

const forgeConfig: ForgeConfig = {
    packagerConfig: {
        icon: process.platform === 'linux' ? './icons/icon.png' : './icons/icon',
        name: 'PulseSync',
        executableName: 'PulseSync',
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
                {
                    entry: 'src/main/preloaderPreload.ts',
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
                {
                    name: 'settings_window',
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
            console.log(`Built app ${platform}-${arch} with Electron ${electronVersion}`)
        },
    },
}

export default forgeConfig
