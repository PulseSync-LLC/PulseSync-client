import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
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
import * as fs from 'original-fs'
import { initializeStore, store } from './main/modules/storage'
import createTray from './main/modules/tray'
import corsAnywhereServer from 'cors-anywhere'
import getPort from 'get-port'
import config from './config.json'
import {
    handleDeeplink,
    handleDeeplinkOnApplicationStartup,
} from './main/modules/handlers/handleDeepLink'
import { checkForSingleInstance } from './main/modules/singleInstance'
import * as Sentry from '@sentry/electron/main'
import { eventEmitter, sendAddon, setAddon } from './main/modules/httpServer'
import { handleAppEvents, updateAvailable } from './main/events'
import { formatJson, formatSizeUnits, getFolderSize, getPathToYandexMusic } from './main/utils/appUtils'
import Addon from './renderer/api/interfaces/addon.interface'
import logger from './main/modules/logger'
import isAppDev from 'electron-is-dev'
import { handleMod } from './main/modules/mod/modManager'
import chokidar from 'chokidar'
import { getUpdater } from './main/modules/updater/updater'
import { promisify } from 'util'

declare const MAIN_WINDOW_WEBPACK_ENTRY: string
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string

declare const PRELOADER_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_WEBPACK_ENTRY: string

export let corsAnywherePort: string | number
export let mainWindow: BrowserWindow
export let updated = false
export let inSleepMode = false
let hardwareAcceleration = false

let preloaderWindow: BrowserWindow
let availableAddons: Addon[] = []
export let selectedAddon: string
const defaultAddon = {
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
const icon = getNativeImg('appicon', '.ico', 'icon').resize({
    width: 40,
    height: 40,
})
app.setAppUserModelId('pulsesync.app')
initializeStore().then(() => {
    logger.main.info('Store initialized')
    hardwareAcceleration = store.get('settings.hardwareAcceleration', true)
    if (!hardwareAcceleration) {
        app.disableHardwareAcceleration()
    }
})

if (!isAppDev) {
    logger.main.info('Sentry enabled')
    Sentry.init({
        dsn: config.SENTRY_DSN,
        debug: isAppDev,
        release: `pulsesync@${app.getVersion()}`,
        environment: isAppDev ? "development" : "production",
        attachStacktrace: true,
        enableRendererProfiling: true,
        attachScreenshot: true,
    })
}

function checkCLIArguments() {
    const args = process.argv.slice(1)
    if (args.length > 0 && !isAppDev) {
        if (args.some((arg) => arg.startsWith('pulsesync://'))) {
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
            webgl: hardwareAcceleration,
            enableBlinkFeatures: hardwareAcceleration ? 'WebGL2' : '',
        },
    })
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).catch((e) => {
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

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && (input.key === '+' || input.key === '-')) {
            event.preventDefault()
        }
    })
    mainWindow.webContents.setWindowOpenHandler((electronData) => {
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
        if (inSleepMode && updateAvailable) {
            getUpdater().install()
        }
        inSleepMode = false
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
        scheme: 'sentry-ipc',
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
    await checkForSingleInstance()
    handleAppEvents(mainWindow)
    handleMod(mainWindow)
    handleDeeplinkOnApplicationStartup()
    handleDeeplink(mainWindow)
    createTray()
})
function createDefaultAddonIfNotExists(themesFolderPath: string) {
    const defaultAddonPath = path.join(themesFolderPath, defaultAddon.name)
    try {
        if (!fs.existsSync(defaultAddonPath)) {
            fs.mkdirSync(defaultAddonPath, { recursive: true })
            fs.mkdirSync(path.join(themesFolderPath, defaultAddon.name, 'Assets'), {
                recursive: true,
            })

            const metadataPath = path.join(defaultAddonPath, 'metadata.json')
            const cssPath = path.join(defaultAddonPath, defaultAddon.css)
            const scriptPath = path.join(defaultAddonPath, defaultAddon.script)

            fs.writeFileSync(
                metadataPath,
                JSON.stringify(defaultAddon, null, 2),
                'utf-8',
            )
            fs.writeFileSync(cssPath, defaultCssContent, 'utf-8')
            fs.writeFileSync(scriptPath, defaultScriptContent, 'utf-8')

            logger.main.info(`Addons: default theme created at ${defaultAddonPath}.`)
        }
    } catch (err) {
        logger.main.error('Addon: error creating default theme:', err)
    }
}
async function loadAddons(): Promise<Addon[]> {
    const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')

    try {
        createDefaultAddonIfNotExists(addonsFolderPath)
        const folders = await fs.promises.readdir(addonsFolderPath)
        availableAddons = []

        for (const folder of folders) {
            const themeFolderPath = path.join(addonsFolderPath, folder)
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
                    const metadata = JSON.parse(data) as Addon
                    const versionMatch = metadata.version.match(versionRegex)
                    if (!versionMatch) {
                        logger.main.log(
                            `Addons: No valid version found in theme ${metadataFilePath}. Setting version to 1.0.0`,
                        )
                        metadata.version = '1.0.0'
                        await fs.promises
                            .writeFile(
                                metadataFilePath,
                                JSON.stringify(metadata, null, 4),
                                'utf-8',
                            )
                            .catch((err) => {
                                logger.main.error(
                                    `Addons: error writing metadata.json in theme ${folder}:`,
                                    err,
                                )
                            })
                    } else {
                        metadata.version = versionMatch[0]
                    }
                    metadata.lastModified = diffString
                    metadata.path = themeFolderPath
                    metadata.size = formatSizeUnits(folderSize)
                    metadata.directoryName = folder
                    availableAddons.push(metadata)
                } catch (err) {
                    logger.main.error(
                        `Addons: error reading or parsing metadata.json in theme ${folder}:`,
                        err,
                    )
                }
            } else {
                logger.main.error(
                    `Addons: metadata.json not found in theme ${folder}`,
                )
            }
        }

        return availableAddons
    } catch (err) {
        logger.main.error('Error reading themes directory:', err)
        throw err
    }
}

ipcMain.handle('getAddons', async () => {
    try {
        return await loadAddons()
    } catch (error) {
        logger.main.error('Addons: Error loading themes:', error)
    }
})

ipcMain.handle('file-event', async (_, eventType, filePath, data) => {
    switch (eventType) {
        case 'check-file-exists':
            try {
                await fs.promises.access(filePath)
                return true
            } catch {
                return false
            }

        case 'read-file':
            try {
                const fileData = await fs.promises.readFile(filePath, 'utf8')
                return fileData
            } catch (error) {
                console.error('Ошибка при чтении файла:', error)
                return null
            }

        case 'create-config-file':
            try {
                await fs.promises.writeFile(filePath, formatJson(data), 'utf8')
                return { success: true }
            } catch (error) {
                logger.main.error('Ошибка при создании файла конфигурации:', error)
                return { success: false, error: error.message }
            }

        case 'write-file':
            try {
                const content =
                    typeof data === 'string' ? data : JSON.stringify(data, null, 2)
                fs.writeFileSync(filePath, content, 'utf8')
                logger.main.log('Файл успешно записан:', filePath)
                return { success: true }
            } catch (error) {
                logger.main.error('Ошибка при записи файла:', error)
                return { success: false, error: error.message }
            }

        default:
            logger.main.error('Неизвестный тип события:', eventType)
            return { success: false, error: 'Неизвестный тип события' }
    }
})

ipcMain.handle('deleteAddonDirectory', async (event, themeDirectoryPath) => {
    try {
        if (fs.existsSync(themeDirectoryPath)) {
            await fs.promises.rm(themeDirectoryPath, {
                recursive: true,
                force: true,
            })
            return { success: true }
        } else {
            logger.main.error('Директория темы не найдена.')
        }
    } catch (error) {
        logger.main.error('Ошибка при удалении директории темы:', error)
    }
})

ipcMain.on('themeChanged', (event, addon: Addon) => {
    logger.main.info(`Addons: theme changed to: ${addon.directoryName}`)
    selectedAddon = addon.directoryName
    setAddon(selectedAddon)
})
function initializeAddon() {
    selectedAddon = store.get('addons.theme') || 'Default'
    logger.main.log('Addons: theme changed to:', selectedAddon)
    setAddon(selectedAddon)
}
export const getPath = (args: string) => {
    const savePath = app.getPath('userData')
    return path.resolve(`${savePath}/extensions/${args}`)
}
app.whenReady().then(async () => {
    if (isAppDev) {
        try {
            if ((session.defaultSession as any).loadExtension) {
                return (session.defaultSession as any)
                    .loadExtension(getPath('fmkadmapgofadopljbjfkapdkoienihi'))
                    .then((ext: { name: string }) => {
                        return Promise.resolve(ext.name)
                    })
            }
        } catch (e) {
            logger.main.error(e)
        }
    }
})
export async function prestartCheck() {
    const musicDir = app.getPath('music')
    const musicPath = await getPathToYandexMusic()

    if (!fs.existsSync(musicPath)) {
        new Notification({
            title: 'Яндекс Музыка не найдена 😡',
            body: 'Пожалуйста, откройте приложение после установки музыки',
        }).show()
        dialog.showMessageBox({
            type: 'info',
            title: 'Яндекс Музыка не найдена 😡',
            message: 'Пожалуйста, откройте приложение после установки музыки',
            buttons: ['OK'],
        })
        setTimeout(async () => {
            app.quit()
        }, 2500)
    }
    if (!fs.existsSync(path.join(musicDir, 'PulseSyncMusic'))) {
        fs.mkdirSync(path.join(musicDir, 'PulseSyncMusic'))
    }
    const readdir = promisify(fs.readdir);
    const rename = promisify(fs.rename);

    await (async () => {
        const pulseSyncPath = path.join(app.getPath('appData'), 'PulseSync');
        const themesFolderPath = path.join(pulseSyncPath, 'themes');
        const addonsFolderPath = path.join(pulseSyncPath, 'addons');

        try {
            const files = await readdir(themesFolderPath);
            if (files.length) {
                await rename(themesFolderPath, addonsFolderPath);
                logger.main.info('Папка themes переименована в addons.');
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                logger.main.error('Ошибка при переименовании папки themes:', err);
            }
        }
    })();
    const asarCopy = path.join(musicPath, 'app.backup.asar')

    if (!store.has('discordRpc.enableGithubButton')) {
        store.set('discordRpc.enableGithubButton', true)
    }
    if (!store.has('discordRpc.appId')) {
        store.set('discordRpc.appId', '')
    }
    if (!store.has('settings.closeAppInTray')) {
        store.set('settings.closeAppInTray', true)
    }
    if (
        (store.has('mod.installed') && store.get('mod.installed')) ||
        store.get('mod.version')
    ) {
        if (!fs.existsSync(asarCopy)) {
            store.set('mod.installed', false)
            store.delete('mod.version')
        }
    } else if (fs.existsSync(asarCopy)) {
        store.set('mod.installed', true)
    }
    initializeAddon()
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    logger.main.info(app.getPath('appData'))
    const watcher = chokidar.watch(themesPath, {
        persistent: true,
        ignored: (path, stats) => stats?.isFile() && !path.endsWith('.css'),
    })
    watcher
        .on('add', (path) => {
            logger.main.info(`File ${path} has been added`)
            sendAddon(false)
        })
        .on('change', (path) => {
            logger.main.info(`File ${path} has been changed`)
            sendAddon(false)
        })
        .on('unlink', (path) => {
            logger.main.info(`File ${path} has been removed`)
            sendAddon(false)
        })
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

eventEmitter.on('DATA_UPDATED', (newData) => {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('trackinfo', newData)
    }
})
