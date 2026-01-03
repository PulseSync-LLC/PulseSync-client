import { app, BrowserWindow, shell, powerMonitor, screen } from 'electron'
import { getNativeImg } from '../utils/electronNative'
import isAppDev from 'electron-is-dev'
import { getUpdater } from './updater/updater'
import { updateAvailable } from '../events'
import { isWindows } from '../utils/appUtils'
import { isDevmark } from '../../renderer/api/web_config'
import path from 'path'
import fs from 'original-fs'
import logger from './logger'
import { getState } from './state'

declare const MAIN_WINDOW_WEBPACK_ENTRY: string
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_PRELOAD_WEBPACK_ENTRY: string
declare const PRELOADER_WEBPACK_ENTRY: string

const State = getState()
declare const SETTINGS_WINDOW_WEBPACK_ENTRY: string
declare const SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY: string

export let mainWindow: BrowserWindow
export let settingsWindow: BrowserWindow
export let inSleepMode = false

const minMain = { width: 1157, height: 750 }
const preloaderSize = { width: 250, height: 271 }

const isWithinDisplayBounds = (pos: { x: number; y: number }, display: Electron.Display) => {
    const area = display.workArea
    return pos.x >= area.x && pos.y >= area.y && pos.x < area.x + area.width && pos.y < area.y + area.height
}

export async function createWindow(): Promise<void> {
    const restorePos = State.get('settings.saveWindowPositionOnRestart') ?? true
    const restoreDim = State.get('settings.saveWindowDimensionsOnRestart') ?? true
    const savedPosition = restorePos ? State.get('settings.windowPosition') : undefined
    const savedDimensions = restoreDim ? State.get('settings.windowDimensions') : undefined

    let position: { x: number; y: number } | undefined =
        savedPosition && typeof savedPosition.x === 'number' && typeof savedPosition.y === 'number'
            ? { x: savedPosition.x, y: savedPosition.y }
            : undefined

    const dimensions: { width: number; height: number } | undefined =
        savedDimensions && typeof savedDimensions.width === 'number' && typeof savedDimensions.height === 'number'
            ? { width: savedDimensions.width, height: savedDimensions.height }
            : undefined

    const lastDisplayId: number | undefined = State.get('settings.lastDisplayId')
    const displays = screen.getAllDisplays()
    let usedDisplay: Electron.Display

    if (restorePos && position) {
        const nearest = screen.getDisplayNearestPoint(position)
        if (isWithinDisplayBounds(position, nearest)) {
            usedDisplay = nearest
        } else {
            position = undefined
            usedDisplay = screen.getPrimaryDisplay()
        }
    } else if (lastDisplayId) {
        usedDisplay = displays.find(d => d.id === lastDisplayId) || screen.getPrimaryDisplay()
        position = undefined
    } else {
        usedDisplay = screen.getPrimaryDisplay()
        position = undefined
    }

    State.set('settings.lastDisplayId', usedDisplay.id)
    const workArea = usedDisplay.workArea
    const prePos = {
        x: Math.floor(workArea.x + (workArea.width - preloaderSize.width) / 2),
        y: Math.floor(workArea.y + (workArea.height - preloaderSize.height) / 2),
    }

    const iconExt = isWindows() ? '.ico' : '.png'
    const icon = getNativeImg('App', iconExt, 'icon').resize({ width: 40, height: 40 })
    const preloaderWindow = new BrowserWindow({
        x: prePos.x,
        y: prePos.y,
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
        width: dimensions?.width ?? minMain.width,
        height: dimensions?.height ?? minMain.height,
        ...(position ? { x: position.x, y: position.y } : { center: true }),
        minWidth: minMain.width,
        minHeight: minMain.height,
        trafficLightPosition: { x: 16, y: 10 },
        icon,
        webPreferences: {
            preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
            nodeIntegration: true,
            devTools: isAppDev || isDevmark,
            webgl: State.get('settings.hardwareAcceleration'),
            enableBlinkFeatures: State.get('settings.hardwareAcceleration') ? 'WebGL2' : '',
        },
    })

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).catch(console.error)
    mainWindow.once('ready-to-show', () => {
        preloaderWindow.close()
        preloaderWindow.destroy()
        if (!State.get('settings.autoStartInTray')) {
            mainWindow.show()
            mainWindow.moveTop()
        }
    })

    mainWindow.webContents.on('before-input-event', (e, input) => {
        if (input.control && (input.key === '+' || input.key === '-')) {
            e.preventDefault()
        }
    })

    mainWindow.webContents.setWindowOpenHandler(data => {
        const url = data.url
        const marker = '/main_window/'
        const idx = url.indexOf(marker)
        if (idx !== -1) {
            const after = url.slice(idx + marker.length)
            const parts = after.split('/')
            const addon = parts.shift()
            const rel = parts.join(path.sep)
            const dir = path.join(app.getPath('appData'), 'PulseSync', 'addons', addon!)
            const full = path.join(dir, rel)
            if (fs.existsSync(full)) {
                shell.openExternal(`file://${full}`)
            } else {
                logger.renderer.error(`Файл не найден: ${full}`)
            }
            return { action: 'deny' }
        }
        shell.openExternal(url)
        return { action: 'deny' }
    })

    mainWindow.on('resized', (): void => {
        const [widthBefore, heightBefore] = mainWindow.getSize()
        const newWidth = Math.floor(widthBefore / 2) * 2
        const newHeight = Math.floor(heightBefore / 2) * 2
        mainWindow.setSize(newWidth, newHeight)
        const [width, height] = mainWindow.getSize()
        State.set('settings.windowDimensions', { width, height })
    })

    mainWindow.on('moved', (): void => {
        const [x, y] = mainWindow.getPosition()
        State.set('settings.windowPosition', { x, y })
    })

    mainWindow.on('close', () => {
        const bounds = mainWindow.getBounds()
        const disp = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
        State.set('settings.lastDisplayId', disp.id)
    })

    if (isAppDev) {
        Object.defineProperty(app, 'isPackaged', { get: () => true })
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
export function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus()
        return
    }

    settingsWindow = new BrowserWindow({
        width: 1157,
        height: 750,
        minWidth: 1157,
        minHeight: 750,
        resizable: true,
        fullscreenable: true,
        frame: false,
        backgroundColor: '#16181E',
        webPreferences: {
            preload: SETTINGS_WINDOW_PRELOAD_WEBPACK_ENTRY,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    settingsWindow.loadURL(SETTINGS_WINDOW_WEBPACK_ENTRY)
    settingsWindow.on('closed', () => {
        settingsWindow = null
    })
}
