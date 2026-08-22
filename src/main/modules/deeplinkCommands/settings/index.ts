import { BrowserWindow } from 'electron'

import { isSettingsDeepLinkSection } from '@common/settingsDeepLink'
import RendererEvents from '@common/types/rendererEvents'

import logger from '../../logger'
import { isUiReady, runWhenUiReady } from '../../uiReady'

import type { DeeplinkCommandContext } from '..'
import type { OpenSettingsModalPayload, SettingsDeepLinkSection } from '@common/settingsDeepLink'

const DEFAULT_SETTINGS_SECTION: SettingsDeepLinkSection = 'general'

const resolveSettingsSection = (value?: string): SettingsDeepLinkSection => {
    if (!value) return DEFAULT_SETTINGS_SECTION

    let decodedValue = value
    try {
        decodedValue = decodeURIComponent(value)
    } catch {
        // Keep the original path segment when it is not valid URI encoding.
    }

    const normalizedValue = decodedValue.trim().toLowerCase()
    if (isSettingsDeepLinkSection(normalizedValue)) return normalizedValue

    logger.main.warn(`Unknown settings deeplink section: ${value}`)
    return DEFAULT_SETTINGS_SECTION
}

export default async function settingsCommand(context: DeeplinkCommandContext): Promise<boolean> {
    const activeSection = resolveSettingsSection(context.args[0])
    const resolveTargetWindow = (): BrowserWindow | undefined => {
        if (context.window && !context.window.isDestroyed()) return context.window
        return BrowserWindow.getAllWindows().find(window => !window.isDestroyed())
    }
    const openSettings = () => {
        const targetWindow = resolveTargetWindow()
        if (!targetWindow) {
            logger.main.warn('Could not open settings from deeplink: no window is available')
            return
        }

        const payload: OpenSettingsModalPayload = {
            activeSection,
            modalName: 'SETTINGS',
        }
        targetWindow.webContents.send(RendererEvents.OPEN_MODAL, payload)
        logger.main.info(`Opened settings from deeplink: ${activeSection}`)
    }

    if (isUiReady()) {
        openSettings()
    } else {
        runWhenUiReady(openSettings)
        logger.main.info(`Queued settings deeplink until UI_READY: ${activeSection}`)
    }

    return true
}
