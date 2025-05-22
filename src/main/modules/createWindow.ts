import { app, BrowserWindow, shell, powerMonitor } from 'electron'
import { getNativeImg } from '../utils/electronNative'
import isAppDev from 'electron-is-dev'
import { store } from './storage'
import { getUpdater } from './updater/updater'
import { updateAvailable } from '../events'

declare const MAIN_WINDOW_WEBPACK_ENTRY: string
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_WEBPACK_ENTRY: string

export let mainWindow: BrowserWindow
export let inSleepMode = false

const icon = getNativeImg('appicon', '.ico', 'icon').resize({
    width: 40,
    height: 40,
})

export function createWindow(): void {
    let preloaderWindow: BrowserWindow

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
            webgl: store.get('settings.hardwareAcceleration', true),
            enableBlinkFeatures: store.get('settings.hardwareAcceleration', true) ? 'WebGL2' : '',
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
