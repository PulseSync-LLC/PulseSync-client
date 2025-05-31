import { app, BrowserWindow, ipcMain } from 'electron'
import process from 'process'
import './main/modules/index'
import path from 'path'
import * as fs from 'original-fs'
import { initializeStore, store } from './main/modules/storage'
import createTray from './main/modules/tray'
import config from './config.json'
import { handleDeeplink, handleDeeplinkOnApplicationStartup } from './main/modules/handlers/handleDeepLink'
import { checkForSingleInstance } from './main/modules/singleInstance'
import * as Sentry from '@sentry/electron/main'
import { sendAddon, setAddon } from './main/modules/httpServer'
import { checkAsar, formatJson, getPathToYandexMusic, isLinux } from './main/utils/appUtils'
import logger from './main/modules/logger'
import isAppDev from 'electron-is-dev'
import { modManager } from './main/modules/mod/modManager'
import chokidar from 'chokidar'
import { HandleErrorsElectron } from './main/modules/handlers/handleErrorsElectron'
import * as dns from 'node:dns'

import { checkCLIArguments } from './main/utils/processUtils'
import { initializeCorsAnywhere, registerSchemes } from './main/utils/serverUtils'
import { createDefaultAddonIfNotExists } from './main/utils/addonUtils'
import { createWindow, mainWindow } from './main/modules/createWindow'
import { handleEvents } from './main/events'
import Addon from './renderer/api/interfaces/addon.interface'

export let corsAnywherePort: string | number
export let updated = false
export let hardwareAcceleration = false
export let musicPath = getPathToYandexMusic()
export let asarFilename = 'app.backup.asar'
export let asarBackup = path.join(musicPath, asarFilename)
export let selectedAddon: string

registerSchemes()

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1'])
app.commandLine.appendSwitch('dns-server', '8.8.8.8,8.8.4.4,1.1.1.1,1.0.0.1')

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

function checkCLIArgumentsWrapper() {
    updated = checkCLIArguments(isAppDev)
}

app.on('ready', async () => {
    HandleErrorsElectron.processStoredCrashes()
    corsAnywherePort = await initializeCorsAnywhere()
    checkCLIArgumentsWrapper()
    createWindow()
    await checkForSingleInstance()
    handleEvents(mainWindow)
    modManager(mainWindow)
    handleDeeplinkOnApplicationStartup()
    handleDeeplink(mainWindow)
    createTray()
})

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

function initializeAddon() {
    selectedAddon = store.get('addons.theme') || 'Default'
    logger.main.log('Addons: theme changed to:', selectedAddon)
    setAddon(selectedAddon)
}
ipcMain.handle('file-event', async (_event, eventType, filePath, data) => {
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

// IPC: delete addon directory
ipcMain.handle('deleteAddonDirectory', async (_event, themeDirectoryPath) => {
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

ipcMain.on('themeChanged', async (_event, addon: Addon) => {
    try {
        if (!addon) {
            logger.main.error('Addons: No addon data received')
            return
        }
        const addonsFolder = path.join(app.getPath('appData'), 'PulseSync', 'addons')
        const addonFolder = path.join(addonsFolder, addon.directoryName)
        const metadataPath = path.join(addonFolder, 'metadata.json')

        let validated: Addon
        if (fs.existsSync(metadataPath)) {
            const data = await fs.promises.readFile(metadataPath, 'utf-8')
            validated = JSON.parse(data) as Addon
            if (!validated.directoryName) {
                validated.directoryName = addon.directoryName
            }
        } else {
            throw new Error(`Metadata file not found for addon ${addon.directoryName}`)
        }

        if (validated.type !== 'theme') {
            logger.main.warn(
                `Addons: Received theme change for addon ${validated.directoryName} with type '${validated.type}'. Reverting to Default theme.`,
            )
            selectedAddon = 'Default'
        } else {
            selectedAddon = validated.directoryName
        }
        logger.main.info(`Addons: theme changed to: ${selectedAddon}`)
        setAddon(selectedAddon)
    } catch (error: any) {
        logger.main.error(`Addons: Error processing theme change: ${error.message}`)
        selectedAddon = 'Default'
        setAddon(selectedAddon)
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
    createDefaultAddonIfNotExists(themesPath)

    const watcher = chokidar.watch([path.join(themesPath, '**/*.js'), path.join(themesPath, '**/*.css')], { persistent: true, ignoreInitial: false })

    watcher
        .on('add', p => {
            logger.main.info(`File ${p} has been added`)
            sendAddon(true)
        })
        .on('change', p => {
            logger.main.info(`File ${p} has been changed`)
            sendAddon(true)
        })
        .on('unlink', p => {
            logger.main.info(`File ${p} has been removed`)
            sendAddon(true)
        })
}
