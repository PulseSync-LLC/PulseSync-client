import { BrowserWindow } from 'electron'

import { queueAddonOpen } from '../events'
import { createDeeplinkCommandsHandler, findDeepLinkArg, navigateToDeeplink } from './handleDeeplinks'
import logger from './logger'
import { importPextFile, isPextFilePath, normalizePextPath } from './pextImporter'

import type { LaunchRequestEnvelopeV1 } from './bootstrapper/contracts'

export { consumePendingBrowserAuthFromDeepLink,consumePendingInstallModUpdateFromPath } from './handleDeeplinks'

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

    return async request => {
        const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed())
        const deepLinkArg = findDeepLinkArg(request.argv)
        const pextPath = findPextArg(request.argv)

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
            logger.main.info('Show window for launch request', { id: request.id, kind: request.kind })
        }
    }
}
