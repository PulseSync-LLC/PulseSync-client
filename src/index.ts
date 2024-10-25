import {
    app,
    BrowserWindow,
    ipcMain,
    nativeTheme,
    Notification,
    powerMonitor,
    protocol,
    session,
    shell,
} from 'electron'
import process from 'process'
import { getNativeImg } from './main/utils'
import './main/modules/index'
import path from 'path'
import fs from 'fs'
import { store } from './main/modules/storage'
import createTray from './main/modules/tray'
import { rpc_connect } from './main/modules/discordRpc'
import corsAnywhereServer from 'cors-anywhere'
import getPort from 'get-port'
import config from './config.json'
import {
    handleDeeplink,
    handleDeeplinkOnApplicationStartup,
} from './main/modules/handlers/handleDeepLink'
import { checkForSingleInstance } from './main/modules/singleInstance'
import * as Sentry from '@sentry/electron/main'
import { getTrackInfo, setTheme } from './main/modules/httpServer'
import { handleAppEvents } from './main/events'
import { getPathToYandexMusic } from '../utils/appUtils'
import Theme from './renderer/api/interfaces/theme.interface'
import logger from './main/modules/logger'
import isAppDev from 'electron-is-dev'

declare const MAIN_WINDOW_WEBPACK_ENTRY: string
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string

declare const PRELOADER_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_WEBPACK_ENTRY: string

export let corsAnywherePort: string | number
export let mainWindow: BrowserWindow
export let updated = false
export let inSleepMode = false

let preloaderWindow: BrowserWindow
let availableThemes: Theme[] = []
let selectedTheme: string
const defaultTheme = {
    name: 'Default',
    image: 'url',
    author: 'Your Name',
    description: 'Default theme.',
    version: '1.0.0',
    css: 'style.css',
    script: 'script.js',
}

const defaultCssContent = `{}`

const defaultScriptContent = ``
const icon = getNativeImg('appicon', '.png', 'icon').resize({
    width: 40,
    height: 40,
})
app.setAppUserModelId('pulsesync.app')
Sentry.init({
    debug: false,
    dsn: config.SENTRY_DSN,
    enableRendererProfiling: true,
    enableTracing: true,
})

function checkCLIArguments() {
    const args = process.argv.slice(1)
    if (args.length > 0 && !isAppDev) {
        if (args.some(arg => arg.startsWith('pulsesync://'))) {
            return
        }
        if (args.includes('--updated')) {
            new Notification({
                title: 'Обновление завершено',
                body: 'Посмотреть список изменений можно в приложении',
            }).show()
            updated = true
            return
        }
        return app.quit()
    }
}
const createWindow = (): void => {
    preloaderWindow = new BrowserWindow({
        width: 250,
        height: 271,
        backgroundColor: '#08070d',
        show: false,
        resizable: false,
        fullscreenable: false,
        movable: true,
        frame: false,
        alwaysOnTop: true,
        transparent: false,
        roundedCorners: true,
        webPreferences: {
            preload: PRELOADER_PRELOAD_WEBPACK_ENTRY,
            contextIsolation: true,
            nodeIntegration: true,
            webSecurity: false,
        },
    })

    preloaderWindow.loadURL(PRELOADER_WEBPACK_ENTRY)
    preloaderWindow.once('ready-to-show', () => preloaderWindow.show())

    // Create the browser window.
    mainWindow = new BrowserWindow({
        show: false,
        frame: false,
        backgroundColor: '#16181E',
        width: 1157,
        height: 750,
        minWidth: 1157,
        minHeight: 750,
        transparent: false,
        icon,
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            nodeIntegration: true,
            devTools: isAppDev,
            webSecurity: false,
        },
    })
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).catch(e => {
        console.error(e)
    })

    mainWindow.once('ready-to-show', () => {
        preloaderWindow.close()
        preloaderWindow.destroy()
        if (!store.get('settings.autoStartInTray')) {
            mainWindow.show()
            mainWindow.moveTop()
        }
    })
    mainWindow.webContents.setWindowOpenHandler(electronData => {
        shell.openExternal(electronData.url)
        return { action: 'deny' }
    })
    if (isAppDev) {
        Object.defineProperty(app, 'isPackaged', {
            get() {
                return true
            },
        })
    }
    powerMonitor.on('suspend', () => {
        inSleepMode = true
    })
    powerMonitor.on('resume', () => {
        inSleepMode = false
    })
    function toggleNativeTheme() {
        nativeTheme.themeSource = 'light'

        setTimeout(() => {
            nativeTheme.themeSource = 'dark'
        }, 100)
    }
    mainWindow.webContents.on('devtools-opened', () => {
        toggleNativeTheme()
    })
}
const corsAnywhere = async () => {
    corsAnywherePort = await getPort()

    corsAnywhereServer.createServer().listen(corsAnywherePort, 'localhost')
}
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'http',
        privileges: {
            standard: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
    {
        scheme: 'ws',
        privileges: {
            standard: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
    {
        scheme: 'wss',
        privileges: {
            standard: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
    {
        scheme: 'file',
        privileges: {
            standard: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
    {
        scheme: 'https',
        privileges: {
            standard: true,
            bypassCSP: true,
            allowServiceWorkers: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
    { scheme: 'mailto', privileges: { standard: true } },
])

app.on('ready', async () => {
    await corsAnywhere()
    checkCLIArguments()
    createWindow() // Все что связано с mainWindow должно устанавливаться после этого метода
    checkForSingleInstance()
    handleAppEvents(mainWindow)
    handleDeeplinkOnApplicationStartup()
    handleDeeplink(mainWindow)
    createTray()
})
function createDefaultThemeIfNotExists(themesFolderPath: string) {
    const defaultThemePath = path.join(themesFolderPath, defaultTheme.name)
    try {
        if (!fs.existsSync(defaultThemePath)) {
            fs.mkdirSync(defaultThemePath, { recursive: true })
            fs.mkdirSync(
                path.join(themesFolderPath, defaultTheme.name, 'Assets'),
                {
                    recursive: true,
                },
            )

            const metadataPath = path.join(defaultThemePath, 'metadata.json')
            const cssPath = path.join(defaultThemePath, defaultTheme.css)
            const scriptPath = path.join(defaultThemePath, defaultTheme.script)

            fs.writeFileSync(
                metadataPath,
                JSON.stringify(defaultTheme, null, 2),
                'utf-8',
            )
            fs.writeFileSync(cssPath, defaultCssContent, 'utf-8')
            fs.writeFileSync(scriptPath, defaultScriptContent, 'utf-8')

            logger.main.info(
                `Themes: default theme created at ${defaultThemePath}.`,
            )
        }
    } catch (err) {
        logger.main.error('Theme: error creating default theme:', err)
    }
}
async function loadThemes(): Promise<Theme[]> {
    const themesFolderPath = path.join(
        app.getPath('appData'),
        'PulseSync',
        'themes',
    )

    try {
        createDefaultThemeIfNotExists(themesFolderPath)
        const folders = await fs.promises.readdir(themesFolderPath)
        availableThemes = []

        for (const folder of folders) {
            const themeFolderPath = path.join(themesFolderPath, folder)
            const metadataFilePath = path.join(themeFolderPath, 'metadata.json')

            if (fs.existsSync(metadataFilePath)) {
                try {
                    const data = await fs.promises.readFile(
                        metadataFilePath,
                        'utf-8',
                    )
                    const stats = await fs.promises.stat(metadataFilePath)
                    const folderSize = await getFolderSize(themeFolderPath)
                    const modificationDate = new Date(stats.mtime)
                    const now = new Date()

                    const diffTime = Math.abs(
                        now.getTime() - modificationDate.getTime(),
                    )
                    let diffString

                    const diffSeconds = Math.floor(diffTime / 1000)
                    const diffMinutes = Math.floor(diffSeconds / 60)
                    const diffHours = Math.floor(diffMinutes / 60)
                    const diffDays = Math.floor(diffHours / 24)

                    if (diffSeconds < 60) {
                        diffString = `${diffSeconds} sec ago`
                    } else if (diffMinutes < 60) {
                        diffString = `${diffMinutes} min ago`
                    } else if (diffHours < 24) {
                        diffString = `${diffHours} hours ago`
                    } else {
                        diffString = `${diffDays} days ago`
                    }

                    const versionRegex = /^\d+(\.\d+){0,2}$/
                    const metadata = JSON.parse(data)
                    const versionMatch = metadata.version.match(versionRegex)
                    if (!versionMatch) {
                        logger.main.log(
                            `Themes: No valid version found in theme ${metadataFilePath}. Setting version to 1.0.0`,
                        )
                        metadata.version = '1.0.0'
                        await fs.promises
                            .writeFile(
                                metadataFilePath,
                                JSON.stringify(metadata, null, 4),
                                'utf-8',
                            )
                            .catch(err => {
                                logger.main.error(
                                    `Themes: error writing metadata.json in theme ${folder}:`,
                                    err,
                                )
                            })
                    } else {
                        metadata.version = versionMatch[0]
                    }
                    metadata.lastModified = diffString
                    metadata.path = themeFolderPath
                    metadata.size = formatSizeUnits(folderSize)
                    availableThemes.push(metadata)
                } catch (err) {
                    logger.main.error(
                        `Themes: error reading or parsing metadata.json in theme ${folder}:`,
                        err,
                    )
                }
            } else {
                logger.main.error(
                    `Themes: metadata.json not found in theme ${folder}`,
                )
            }
        }

        logger.main.info('Themes: Available themes:', availableThemes)
        return availableThemes
    } catch (err) {
        logger.main.error('Error reading themes directory:', err)
        throw err
    }
}
const formatSizeUnits = (bytes: any) => {
    if (bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(2) + ' GB'
    } else if (bytes >= 1048576) {
        return (bytes / 1048576).toFixed(2) + ' MB'
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(2) + ' KB'
    } else if (bytes > 1) {
        return bytes + ' bytes'
    } else if (bytes == 1) {
        return bytes + ' byte'
    } else {
        return '0 byte'
    }
}
const getFolderSize = async (folderPath: any) => {
    let totalSize = 0

    const files = await fs.promises.readdir(folderPath)

    for (const file of files) {
        const filePath = path.join(folderPath, file)
        const stats = await fs.promises.stat(filePath)

        if (stats.isDirectory()) {
            totalSize += await getFolderSize(filePath)
        } else {
            totalSize += stats.size
        }
    }

    return totalSize
}
ipcMain.handle('getThemes', async () => {
    try {
        return await loadThemes()
    } catch (error) {
        logger.main.error('Themes: Error loading themes:', error)
        throw error
    }
})

ipcMain.on('themeChanged', (event, themeName) => {
    logger.main.info(`Themes: theme changed to: ${themeName}`)
    selectedTheme = themeName
    setTheme(selectedTheme)
})
function initializeTheme() {
    selectedTheme = store.get('theme') || 'Default'
    setTheme(selectedTheme)
}
app.whenReady().then(async () => {
    if (isAppDev) {
        try {
            await session.defaultSession.loadExtension(
                path.join(
                    __dirname,
                    '../',
                    '../',
                    'ReactDevTools',
                    'fmkadmapgofadopljbjfkapdkoienihi',
                    '5.3.1_0',
                ),
            )
        } catch (e) {
            logger.main.error(e)
        }
    }
    initializeTheme()
})
export async function prestartCheck() {
    const musicDir = app.getPath('music')
    const musicPath = await getPathToYandexMusic()
    if (!fs.existsSync(musicPath)) {
        new Notification({
            title: 'Яндекс Музыка не найдена 😡',
            body: 'Пожалуйста, откройте приложение после установки музыки',
        }).show()
        return setTimeout(async () => {
            app.quit()
        }, 1000)
    }
    if (!fs.existsSync(path.join(musicDir, 'PulseSyncMusic'))) {
        fs.mkdirSync(path.join(musicDir, 'PulseSyncMusic'))
    }
    const asarCopy = path.join(musicPath, 'app.asar.copy')
    if (!store.has('discordRpc.enableGithubButton')) {
        store.set('discordRpc.enableGithubButton', true)
    }
    if (!store.has('discordRpc.appId')) {
        store.set('discordRpc.appId', '')
    }
    if (store.has('discordRpc.status') && store.get('discordRpc.status')) {
        rpc_connect()
    }
    if (store.has('patcher.patched') && store.get('patcher.patched')) {
        if (!fs.existsSync(asarCopy)) {
            store.set('patcher.patched', false)
        }
    } else if (fs.existsSync(asarCopy)) {
        store.set('patcher.patched', true)
    }
}
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        ipcMain.emit('discordrpc-clearstate')
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})
app.on('render-process-gone', (event, webContents, detailed) => {
    const REASON_CRASHED = 'crashed'
    const REASON_OOM = 'oom'
    logger.renderer.error(
        'Application crashed',
        detailed.reason,
        detailed.exitCode,
    )
    if ([REASON_CRASHED, REASON_OOM].includes(detailed.reason)) {
        if (detailed.reason === REASON_CRASHED) {
            logger.renderer.info('Relaunching')
            app.relaunch()
        }
        app.exit(0)
    }
})
setInterval(() => {
    let metadata = getTrackInfo()
    if (Object.keys(metadata).length >= 1) {
        mainWindow.webContents.send('trackinfo', metadata)
    }
}, 5000)
