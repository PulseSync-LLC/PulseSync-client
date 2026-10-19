import { app, shell } from 'electron'

import path from 'path'

import RendererEvents from '../../common/types/rendererEvents'
import { mainWindow, showMainWindow } from './createWindow'
import { checkOrFindUpdate } from './events'
import { createDeeplinkCommandsHandler, navigateToDeeplink } from './handleDeeplinks'

export async function openSettings(): Promise<void> {
    if (!showMainWindow()) return
    const handler = await createDeeplinkCommandsHandler()
    await navigateToDeeplink('pulsesync://settings', handler, mainWindow)
}

export async function openDiscord(): Promise<void> {
    await shell.openExternal('https://discord.gg/qy42uGTzRy')
}

export async function openAddonsDirectory(): Promise<void> {
    await shell.openPath(path.join(app.getPath('appData'), 'PulseSync', 'addons'))
}

export async function checkForUpdates(): Promise<void> {
    await checkOrFindUpdate(undefined, true)
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(RendererEvents.CHECK_MOD_UPDATE, { manual: true })
    }
}
