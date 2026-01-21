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
import { t } from '../i18n'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string
declare const PRELOADER_VITE_DEV_SERVER_URL: string
declare const PRELOADER_VITE_NAME: string

const State = getState()
declare const SETTINGS_WINDOW_VITE_DEV_SERVER_URL: string
declare const SETTINGS_WINDOW_VITE_NAME: string

export let mainWindow: BrowserWindow
export let settingsWindow: BrowserWindow
export let inSleepMode = false

const minMain = { width: 1157, height: 750 }
const preloaderSize = { width: 250, height: 271 }

const loadRendererWindow = (
    window: BrowserWindow,
    devServerUrl: string | undefined,
    rendererName: string,
    devHtmlFile: string,
    prodHtmlFile: string,
): Promise<void> => {
    if (devServerUrl) {
        return window.loadURL(`${devServerUrl}/${devHtmlFile}`)
    }
    const filePath = path.join(app.getAppPath(), 'renderer', rendererName, prodHtmlFile)
    return window.loadFile(filePath)
}

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
            preload: path.join(__dirname, 'preloaderPreload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })
    loadRendererWindow(preloaderWindow, PRELOADER_VITE_DEV_SERVER_URL, PRELOADER_VITE_NAME, 'src/renderer/preloader.html', 'preloader.html')
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
            preload: path.join(__dirname, 'mainWindowPreload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: isAppDev || isDevmark,
            webgl: State.get('settings.hardwareAcceleration'),
            enableBlinkFeatures: State.get('settings.hardwareAcceleration') ? 'WebGL2' : '',
        },
    })

    loadRendererWindow(mainWindow, MAIN_WINDOW_VITE_DEV_SERVER_URL, MAIN_WINDOW_VITE_NAME, 'src/renderer/index.html', 'index.html').catch(
        console.error,
    )
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
                logger.renderer.error(t('main.createWindow.fileNotFound', { path: full }))
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
            preload: path.join(__dirname, 'mainWindowPreload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    loadRendererWindow(settingsWindow, SETTINGS_WINDOW_VITE_DEV_SERVER_URL, SETTINGS_WINDOW_VITE_NAME, 'src/renderer/settings.html', 'settings.html')
    settingsWindow.on('closed', () => {
        settingsWindow = null
    })
}
