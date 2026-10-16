import logger from '../shared/logger'
import { mainWindow } from './createWindow'
import { queueAddonOpen } from './events'
import { createDeeplinkCommandsHandler, findDeepLinkArg, navigateToDeeplink } from './handleDeeplinks'
import { importPextFile, isPextFilePath, normalizePextPath } from './pextImporter'
import { getState } from './state'

import type { LaunchRequestEnvelopeV1 } from '../shared/bootstrapper/contracts'

export { consumePendingBrowserAuthFromDeepLink, consumePendingInstallModUpdateFromPath } from './handleDeeplinks'

export let isFirstInstance = false

export function setIsFirstInstance(value: boolean): void {
    isFirstInstance = value
}

const findPextArg = (args: string[]): string | null => {
    for (const raw of [...args].reverse()) {
        const normalized = normalizePextPath(raw)
        if (isPextFilePath(normalized)) return normalized
    }
    return null
}

async function handlePextFile(filePath: string): Promise<void> {
    const addonName = await importPextFile(filePath)
    if (addonName) queueAddonOpen(addonName)
}

export async function createApplicationLaunchRequestHandler(): Promise<(request: LaunchRequestEnvelopeV1) => Promise<void>> {
    const deeplinkCommandsHandler = await createDeeplinkCommandsHandler()
    let initialLaunchHandled = false

    return async request => {
        const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
        const deepLinkArg = findDeepLinkArg(request.argv)
        const pextPath = findPextArg(request.argv)
        const startInTray = Boolean(getState().get('settings.autoStartInTray'))
        const keepInTray = !initialLaunchHandled && startInTray && !deepLinkArg && !pextPath
        initialLaunchHandled = true

        if (keepInTray) return

        if (window?.isMinimized()) {
            window.restore()
            logger.main.info('Restore window')
        }
        if (deepLinkArg) {
            await navigateToDeeplink(deepLinkArg, deeplinkCommandsHandler, window)
        }
        if (pextPath) {
            await handlePextFile(pextPath)
        }
        if (window) {
            window.show()
            window.focus()
            logger.main.info('Show window for launch request', { id: request.id, kind: request.kind })
        }
    }
}
