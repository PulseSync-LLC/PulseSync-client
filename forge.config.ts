import type { ForgeConfig } from '@electron-forge/shared-types'
import { WebpackPlugin } from '@electron-forge/plugin-webpack'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { mainConfig } from './webpack/webpack.main.config'
import { rendererConfig } from './webpack/webpack.renderer.config'
import path from 'path'
import fs from 'fs'

const forgeConfig: ForgeConfig = {
    packagerConfig: {
        icon: './icons/icon',
        name: 'PulseSync',
        executableName: 'PulseSync',
        appCopyright: 'Copyright (C) 2025 ИП «Деднев Григорий Дмитриевич»',
        asar: true,
        win32metadata: {
            CompanyName: 'ИП «Деднев Григорий Дмитриевич»',
        },
        appBundleId: "pulsesync.app",
        extendInfo: 'Info.plist',
        extraResource: ['./app-update.yml'],
    },
    plugins: [
        new WebpackPlugin({
            mainConfig,
            renderer: {
                config: rendererConfig,
                entryPoints: [
                    {
                        name: 'preloader',
                        html: '../src/renderer/preloader.html',
                        js: '../src/main/preload.ts',
                        preload: { js: '../src/main/preload.ts' },
                    },
                    {
                        name: 'main_window',
                        html: '../src/renderer/index.html',
                        js: '../src/main/renderer.ts',
                        preload: { js: '../src/main/mainWindowPreload.ts' },
                    },
                    {
                        name: 'settings_window',
                        html: '../src/renderer/settings.html',
                        js: '../src/main/settingsRenderer.ts',
                        preload: {
                            js: '../src/main/mainWindowPreload.ts',
                        },
                    },
                ],
            },
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
            console.log(`Built app ${platform}-${arch} with Electron ${electronVersion}`)
        },
    },
}

export default forgeConfig
