import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { BOOTSTRAP_WINDOW_CHANNELS, type BootstrapUiStateV1 } from '@common/types/bootstrapEvents'

declare const PRELOADER_VITE_DEV_SERVER_URL: string
declare const PRELOADER_VITE_NAME: string

const WINDOW_SIZE = 300

export type BootstrapWindowController = {
    destroy(): void
    publish(state: BootstrapUiStateV1): void
    setActionHandlers(handlers: { continue?: () => Promise<boolean>; retry?: () => Promise<boolean> }): void
    window: BrowserWindow
}

const INITIAL_STATE: BootstrapUiStateV1 = {
    schemaVersion: 1,
    phase: 'checking',
    statusKey: 'checking-for-updates',
    progress: { kind: 'indeterminate' },
    actions: [],
}

async function loadBootstrapRenderer(window: BrowserWindow): Promise<void> {
    if (PRELOADER_VITE_DEV_SERVER_URL) {
        await window.loadURL(`${PRELOADER_VITE_DEV_SERVER_URL}/src/renderer/preloader.html`)
        return
    }
    const basePath = path.join(app.getAppPath(), '.vite', 'renderer', PRELOADER_VITE_NAME)
    const candidates = [path.join(basePath, 'src', 'renderer', 'preloader.html'), path.join(basePath, 'preloader.html')]
    await window.loadFile(candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0])
}

export async function createBootstrapWindow(): Promise<BootstrapWindowController> {
    const workArea = screen.getPrimaryDisplay().workArea
    const window = new BrowserWindow({
        x: Math.floor(workArea.x + (workArea.width - WINDOW_SIZE) / 2),
        y: Math.floor(workArea.y + (workArea.height - WINDOW_SIZE) / 2),
        width: WINDOW_SIZE,
        height: WINDOW_SIZE,
        backgroundColor: '#282b30',
        show: false,
        resizable: false,
        fullscreenable: false,
        frame: false,
        alwaysOnTop: true,
        transparent: false,
        roundedCorners: true,
        webPreferences: {
            preload: path.join(__dirname, 'bootstrapWindowPreload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: !app.isPackaged,
        },
    })

    let currentState = INITIAL_STATE
    let retryHandler: (() => Promise<boolean>) | undefined
    let continueHandler: (() => Promise<boolean>) | undefined

    const sendState = (): void => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send(BOOTSTRAP_WINDOW_CHANNELS.state, currentState)
        }
    }
    const onReady = (event: Electron.IpcMainEvent): void => {
        if (event.sender.id === window.webContents.id) sendState()
    }
    const cleanup = (): void => {
        ipcMain.removeListener(BOOTSTRAP_WINDOW_CHANNELS.ready, onReady)
        ipcMain.removeHandler(BOOTSTRAP_WINDOW_CHANNELS.retry)
        ipcMain.removeHandler(BOOTSTRAP_WINDOW_CHANNELS.continue)
    }

    ipcMain.on(BOOTSTRAP_WINDOW_CHANNELS.ready, onReady)
    ipcMain.handle(BOOTSTRAP_WINDOW_CHANNELS.retry, async event => {
        return event.sender.id === window.webContents.id && retryHandler ? await retryHandler() : false
    })
    ipcMain.handle(BOOTSTRAP_WINDOW_CHANNELS.continue, async event => {
        return event.sender.id === window.webContents.id && continueHandler ? await continueHandler() : false
    })
    window.once('closed', cleanup)
    window.once('ready-to-show', () => window.show())
    await loadBootstrapRenderer(window)

    return {
        window,
        publish(state) {
            currentState = state
            sendState()
        },
        setActionHandlers(handlers) {
            retryHandler = handlers.retry
            continueHandler = handlers.continue
        },
        destroy() {
            cleanup()
            if (!window.isDestroyed()) window.destroy()
        },
    }
}
