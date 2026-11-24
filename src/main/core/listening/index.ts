import { app, ipcMain } from 'electron'

import { LISTENING_IPC } from '@common/listening/types'

import { ListeningAccess } from './access'
import { ListeningController } from './controller'

import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export const listening = new ListeningController(new ListeningAccess())
let registered = false
let trustedWindow: BrowserWindow
export function registerListeningEvents(window: BrowserWindow): void {
    listening.bindWindow(window)
    trustedWindow = window
    if (registered) return
    registered = true
    const trusted = (event: IpcMainInvokeEvent) => {
        const window = trustedWindow
        if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
            throw new Error('LISTENING_UNTRUSTED_SENDER')
    }
    ipcMain.handle(LISTENING_IPC.get, event => {
        trusted(event)
        return listening.start()
    })
    ipcMain.handle(LISTENING_IPC.run, (event, operation: unknown) => {
        trusted(event)
        return listening.run(operation)
    })
    ipcMain.handle(LISTENING_IPC.stop, event => {
        trusted(event)
        listening.stop()
    })
    app.once('before-quit', () => listening.stop())
}
