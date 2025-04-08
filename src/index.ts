import { app, BrowserWindow, ipcMain, Notification, powerMonitor, protocol, session as electronSession, shell } from 'electron'
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
import { handleDeeplink, handleDeeplinkOnApplicationStartup } from './main/modules/handlers/handleDeepLink'
import { checkForSingleInstance } from './main/modules/singleInstance'
import * as Sentry from '@sentry/electron/main'
import { eventEmitter, sendAddon, setAddon } from './main/modules/httpServer'
import { handleAppEvents, updateAvailable } from './main/events'
import { checkAsar, formatJson, formatSizeUnits, getFolderSize, getPathToYandexMusic, isLinux } from './main/utils/appUtils'
import Addon from './renderer/api/interfaces/addon.interface'
import logger from './main/modules/logger'
import isAppDev from 'electron-is-dev'
import { handleMod } from './main/modules/mod/modManager'
import chokidar from 'chokidar'
import { getUpdater } from './main/modules/updater/updater'
import { HandleErrorsElectron } from './main/modules/handlers/handleErrorsElectron'
import { installExtension, updateExtensions } from 'electron-chrome-web-store'

declare const MAIN_WINDOW_WEBPACK_ENTRY: string
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string

declare const PRELOADER_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_WEBPACK_ENTRY: string

export let corsAnywherePort: string | number
export let mainWindow: BrowserWindow
export let updated = false
export let inSleepMode = false
export let hardwareAcceleration = false
export let musicPath = getPathToYandexMusic()
export let asarFilename = 'app.backup.asar'
export let asarBackup = path.join(musicPath, asarFilename)

let preloaderWindow: BrowserWindow
export let selectedAddon: string
const defaultAddon: Partial<Addon> = {
    name: 'Default',
    image: 'url',
    author: 'Your Name',
    description: 'Default theme.',
    version: '1.0.0',
    type: 'theme',
    css: 'style.css',
    script: 'script.js',
    dependencies: [],
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
        environment: isAppDev ? 'development' : 'production',
        attachStacktrace: true,
        enableRendererProfiling: true,
        attachScreenshot: true,
    })
}

function checkCLIArguments() {
    const args = process.argv.slice(1)
    if (args.length > 0 && !isAppDev) {
        if (args.some(arg => arg.startsWith('pulsesync://') || arg.endsWith('.pext'))) {
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

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && (input.key === '+' || input.key === '-')) {
            event.preventDefault()
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
    HandleErrorsElectron.processStoredCrashes()
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
    const metadataPath = path.join(defaultAddonPath, 'metadata.json')

    try {
        if (fs.existsSync(defaultAddonPath)) {
            if (fs.existsSync(metadataPath)) {
                let metadata
                try {
                    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
                } catch (err) {
                    logger.main.error(`Addons: error parsing metadata.json in ${defaultAddonPath}:`, err)
                    return
                }
                if (!metadata.hasOwnProperty('type')) {
                    metadata.type = defaultAddon.type
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4), 'utf-8')
                    logger.main.info(`Addons: metadata.json updated in ${defaultAddonPath}.`)
                }
            }
            return
        }

        fs.mkdirSync(defaultAddonPath, { recursive: true })
        fs.mkdirSync(path.join(defaultAddonPath, 'Assets'), { recursive: true })

        const cssPath = path.join(defaultAddonPath, defaultAddon.css)
        const scriptPath = path.join(defaultAddonPath, defaultAddon.script)

        fs.writeFileSync(metadataPath, JSON.stringify(defaultAddon, null, 4), 'utf-8')
        fs.writeFileSync(cssPath, defaultCssContent, 'utf-8')
        fs.writeFileSync(scriptPath, defaultScriptContent, 'utf-8')

        logger.main.info(`Addons: default theme created at ${defaultAddonPath}.`)
    } catch (err) {
        logger.main.error(`Addons: error creating default theme at ${defaultAddonPath}:`, err)
    }
}

async function loadAddons(): Promise<Addon[]> {
    const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')

    try {
        createDefaultAddonIfNotExists(addonsFolderPath)
        const folders = await fs.promises.readdir(addonsFolderPath)
        const availableAddons: Addon[] = []

        for (const folder of folders) {
            const addonFolderPath = path.join(addonsFolderPath, folder)
            const metadataFilePath = path.join(addonFolderPath, 'metadata.json')

            if (fs.existsSync(metadataFilePath)) {
                try {
                    const data = await fs.promises.readFile(metadataFilePath, 'utf-8')
                    const stats = await fs.promises.stat(metadataFilePath)
                    const folderSize = await getFolderSize(addonFolderPath)
                    const modificationDate = new Date(stats.mtime)
                    const now = new Date()

                    const diffTime = Math.abs(now.getTime() - modificationDate.getTime())
                    let diffString: string
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
                        logger.main.log(`Addons: No valid version found in theme ${metadataFilePath}. Setting version to 1.0.0`)
                        metadata.version = '1.0.0'
                        await fs.promises.writeFile(metadataFilePath, JSON.stringify(metadata, null, 4), 'utf-8').catch(err => {
                            logger.main.error(`Addons: error writing metadata.json in theme ${folder}:`, err)
                        })
                    } else {
                        metadata.version = versionMatch[0]
                    }

                    metadata.lastModified = diffString
                    metadata.path = addonFolderPath
                    metadata.size = formatSizeUnits(folderSize)
                    metadata.directoryName = folder

                    availableAddons.push(metadata)
                } catch (err) {
                    logger.main.error(`Addons: error reading or parsing metadata.json in theme ${folder}:`, err)
                }
            } else {
                logger.main.error(`Addons: metadata.json not found in theme ${folder}`)
            }
        }

        let selectedTheme = store.get('addons.theme')
        let selectedScripts: string[] = store.get('addons.scripts')

        const themeAddonExists = availableAddons.some(addon => addon.type === 'theme' && addon.directoryName === selectedTheme)
        if (!themeAddonExists) {
            selectedTheme = 'Default'
            store.set('addons.theme', selectedTheme)
        }

        selectedScripts = availableAddons
            .filter(addon => addon.type === 'script' && selectedScripts.includes(addon.directoryName))
            .map(addon => addon.directoryName)
        store.set('addons.scripts', selectedScripts)

        availableAddons.forEach(addon => {
            if (addon.type === 'theme' && addon.directoryName === selectedTheme) {
                addon.enabled = true
            } else if (addon.type === 'script' && selectedScripts.includes(addon.directoryName)) {
                addon.enabled = true
            }
        })

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
                return await fs.promises.readFile(filePath, 'utf8')
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
                const content = typeof data === 'string' ? data : JSON.stringify(data, null, 4)
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

ipcMain.on('themeChanged', async (event, addon: Addon) => {
    try {
        if (!addon) {
            logger.main.error('Addons: No addon data received')
            return
        }
        const addonsFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const addonFolderPath = path.join(addonsFolderPath, addon.directoryName)
        const metadataFilePath = path.join(addonFolderPath, 'metadata.json')

        let validatedAddon: Addon
        if (fs.existsSync(metadataFilePath)) {
            const data = await fs.promises.readFile(metadataFilePath, 'utf-8')
            validatedAddon = JSON.parse(data) as Addon
            if (!validatedAddon.directoryName) {
                validatedAddon.directoryName = addon.directoryName
            }
        } else {
            throw new Error(`Metadata file not found for addon ${addon.directoryName}`)
        }
        if (validatedAddon.type !== 'theme') {
            logger.main.warn(
                `Addons: Received theme change for addon ${validatedAddon.directoryName} with type '${validatedAddon.type}'. Reverting to Default theme.`,
            )
            selectedAddon = 'Default'
        } else {
            selectedAddon = validatedAddon.directoryName
        }
        logger.main.info(`Addons: theme changed to: ${selectedAddon}`)
        setAddon(selectedAddon)
    } catch (error) {
        logger.main.error(`Addons: Error processing theme change for addon ${addon.directoryName}: ${error.message}`)
        selectedAddon = 'Default'
        setAddon(selectedAddon)
    }
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
function launchExtensionBackgroundWorkers(session = electronSession.defaultSession) {
    return Promise.all(
        session.getAllExtensions().map(async extension => {
            const manifest = extension.manifest
            if (manifest.manifest_version === 3 && manifest?.background?.service_worker) {
                await session.serviceWorkers.startWorkerForScope(extension.url)
            }
        }),
    )
}

app.whenReady().then(async () => {
    if (isAppDev) {
        try {
            await installExtension('fmkadmapgofadopljbjfkapdkoienihi')
            await updateExtensions()
            await launchExtensionBackgroundWorkers()
        } catch (e) {
            logger.main.error(e)
        }
    }
})
export async function prestartCheck() {
    const musicDir = app.getPath('music')

    if (!fs.existsSync(path.join(musicDir, 'PulseSyncMusic'))) {
        fs.mkdirSync(path.join(musicDir, 'PulseSyncMusic'))
    }

    if (isLinux() && store.has('settings.modFilename')) {
        const modFilename = store.get('settings.modFilename')
        asarFilename = `${modFilename}.backup.asar`
    }

    if (!store.has('discordRpc.enableGithubButton')) {
        store.set('discordRpc.enableGithubButton', true)
    }
    if (!store.has('discordRpc.appId')) {
        store.set('discordRpc.appId', '')
    }
    if (!store.has('settings.closeAppInTray')) {
        store.set('settings.closeAppInTray', true)
    }

    checkAsar()
    initializeAddon()
    const themesPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
    logger.main.info(app.getPath('appData'))
    const watcher = chokidar.watch(themesPath, {
        persistent: true,
        ignored: (path, stats) => stats?.isFile() && !path.endsWith('.css'),
    })
    watcher
        .on('add', path => {
            logger.main.info(`File ${path} has been added`)
            sendAddon(false)
        })
        .on('change', path => {
            logger.main.info(`File ${path} has been changed`)
            sendAddon(false)
        })
        .on('unlink', path => {
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

eventEmitter.on('DATA_UPDATED', newData => {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('trackinfo', newData)
    }
})
