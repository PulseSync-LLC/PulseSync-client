import type { ForgeConfig } from '@electron-forge/shared-types'
import { WebpackPlugin } from '@electron-forge/plugin-webpack'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { mainConfig } from './webpack.main.config'
import { rendererConfig } from './webpack.renderer.config'
import path from 'path'
import fs from 'fs-extra'
import os from 'os'

const forgeConfig: ForgeConfig = {
    packagerConfig: {
        icon: './icons/win/icon.ico',
        name: 'PulseSync',
        executableName: 'PulseSync',
        appCopyright: 'Copyright (C) 2025 PulseSync LLC',
        asar: true,
        win32metadata: {
            CompanyName: 'PulseSync LLC',
        },
        extraResource: ['./app-update.yml'],
    },
    rebuildConfig: {},
    makers: [
        {
            "name": "@electron-forge/maker-zip",
            "config": {
                "macUpdateManifestBaseUrl": "${config.UPDATE_URL}/beta/darwin/{{arch}}"
            }
        },
        {
            "name": "@electron-forge/maker-deb",
            "config": {
                "desktopTemplate": "pulsesync.desktop"
            }
        },
        {
            "name": "@electron-forge/maker-rpm",
            "config": {
                "desktopTemplate": "pulsesync.desktop"
            }
        },
        {
            "name": "@electron-forge/maker-dmg",
            "config": {
                "background": "./static/assets/images/no_banner.png",
                "icon": "./icons/mac/icon.icns",
                "format": "ULFO",
                "overwrite": true
            }
        }
    ],
    plugins: [
        new WebpackPlugin({
            mainConfig,
            renderer: {
                config: rendererConfig,
                entryPoints: [
                    {
                        name: 'preloader',
                        html: './src/renderer/preloader.html',
                        js: './src/main/preload.ts',
                        preload: {
                            js: './src/main/preload.ts',
                        },
                    },
                    {
                        name: 'main_window',
                        html: './src/renderer/index.html',
                        js: './src/main/renderer.ts',
                        preload: {
                            js: './src/main/mainWindowPreload.ts',
                        },
                    },

                    {
                        name: 'settings_window',
                        html: './src/renderer/settings.html',
                        js: './src/main/settingsRenderer.ts',
                        preload: {
                            js: './src/main/mainWindowPreload.ts',
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
