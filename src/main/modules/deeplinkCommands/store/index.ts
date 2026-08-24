import { BrowserWindow } from 'electron'

import RendererEvents from '@common/types/rendererEvents'

import logger from '../../logger'
import { isUiReady, runWhenUiReady } from '../../uiReady'

import type { DeeplinkCommandContext } from '..'

const STORE_ADDON_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/u

const resolveStoreAddonId = (value?: string): string | null => {
    if (!value) return null

    let decodedValue = value
    try {
        decodedValue = decodeURIComponent(value)
    } catch {
        // Keep the original segment so the validation below rejects malformed input.
    }

    const addonId = decodedValue.trim()
    return STORE_ADDON_ID_PATTERN.test(addonId) ? addonId : null
}

export default async function storeCommand(context: DeeplinkCommandContext): Promise<boolean> {
    const addonId = resolveStoreAddonId(context.args[0])
    if (!addonId) {
        logger.main.warn(`Invalid store addon deeplink: ${context.rawUrl}`)
        return true
    }

    const resolveTargetWindow = (): BrowserWindow | undefined => {
        if (context.window && !context.window.isDestroyed()) return context.window
        return BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
    }
    const openStoreAddon = () => {
        const targetWindow = resolveTargetWindow()
        if (!targetWindow) {
            logger.main.warn('Could not open store addon from deeplink: no window is available')
            return
        }

        targetWindow.webContents.send(RendererEvents.OPEN_ADDON, { storeAddonId: addonId })
        logger.main.info(`Opened store addon from deeplink: ${addonId}`)
    }

    if (isUiReady()) {
        openStoreAddon()
    } else {
        runWhenUiReady(openStoreAddon)
        logger.main.info(`Queued store addon deeplink until UI_READY: ${addonId}`)
    }

    return true
}
