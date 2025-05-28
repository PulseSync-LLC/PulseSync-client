import { app, BrowserWindow, shell, powerMonitor } from 'electron'
import { getNativeImg } from '../utils/electronNative'
import isAppDev from 'electron-is-dev'
import { store } from './storage'
import { getUpdater } from './updater/updater'
import { updateAvailable } from '../events'
import { isDevmark } from '../../renderer/api/config'
import * as electron from 'electron'

declare const MAIN_WINDOW_WEBPACK_ENTRY: string
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_WEBPACK_ENTRY: string

export let mainWindow: BrowserWindow
export let inSleepMode = false

const isWithinDisplayBounds = (pos: { x: number; y: number }, display: Electron.Display) => {
    const area = display.workArea
    return pos.x >= area.x && pos.y >= area.y && pos.x < area.x + area.width && pos.y < area.y + area.height
}

export function createWindow(): void {
    const savedBounds = store.get('settings.windowBounds')
    const shouldRestore = store.get('settings.saveWindowBoundsOnRestart') ?? true

    let position: { x: number; y: number } | undefined
    let dimensions: { width: number; height: number } | undefined

    if (shouldRestore && savedBounds) {
        position = { x: savedBounds.x, y: savedBounds.y }
        dimensions = { width: savedBounds.width, height: savedBounds.height }
        const nearest = electron.screen.getDisplayNearestPoint(position)
        if (!isWithinDisplayBounds(position, nearest)) {
            position = undefined
        }
    }

    const lastDisplayId = store.get('settings.lastDisplayId')
    const displays = electron.screen.getAllDisplays()
    const preloadDisplay = displays.find(d => d.id === lastDisplayId) || electron.screen.getPrimaryDisplay()
    const workArea = preloadDisplay.workArea
    const preloaderSize = { width: 250, height: 271 }
    const preloaderPosition = {
        x: Math.floor(workArea.x + (workArea.width - preloaderSize.width) / 2),
        y: Math.floor(workArea.y + (workArea.height - preloaderSize.height) / 2),
    }

    const icon = getNativeImg('appicon', '.ico', 'icon').resize({ width: 40, height: 40 })
    const preloaderWindow = new BrowserWindow({
        x: preloaderPosition.x,
        y: preloaderPosition.y,
        width: preloaderSize.width,
        height: preloaderSize.height,
        backgroundColor: '#08070d',
        show: false,
        resizable: false,
        fullscreenable: false,
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
        width: dimensions?.width ?? 1157,
        height: dimensions?.height ?? 750,
        ...(position ? { x: position.x, y: position.y } : { center: true }),
        minWidth: 1157,
        minHeight: 750,
        transparent: false,
        trafficLightPosition: { x: 16, y: 10 },
        icon,
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            nodeIntegration: true,
            devTools: isAppDev || isDevmark,
            webSecurity: true,
            webgl: store.get('settings.hardwareAcceleration', true),
            enableBlinkFeatures: store.get('settings.hardwareAcceleration', true) ? 'WebGL2' : '',
        },
    })

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).catch(e => console.error(e))
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

    mainWindow.on('resized', () => {
        const bounds = mainWindow.getBounds()
        store.set('settings.windowBounds', bounds)
    })
    mainWindow.on('moved', () => {
        const bounds = mainWindow.getBounds()
        store.set('settings.windowBounds', bounds)
    })
    mainWindow.on('close', () => {
        const bounds = mainWindow.getBounds()
        const currentDisplay = electron.screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
        store.set('settings.lastDisplayId', currentDisplay.id)
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
