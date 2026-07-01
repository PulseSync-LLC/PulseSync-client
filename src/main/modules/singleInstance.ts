import { app, BrowserWindow } from 'electron'
import logger from './logger'
import { prestartCheck } from '../../index'
import { queueAddonOpen } from '../events'
import { importPextFile, isPextFilePath, normalizePextPath } from './pextImporter'
import { createDeeplinkCommandsHandler, findDeepLinkArg, navigateToDeeplink } from './handleDeeplinks'

export { consumePendingInstallModUpdateFromPath, consumePendingBrowserAuthFromDeepLink } from './handleDeeplinks'

const allowSecondInstance = !app.isPackaged && process.env.PULSESYNC_ALLOW_SECOND_INSTANCE === '1'

export const isFirstInstance = allowSecondInstance || app.requestSingleInstanceLock()

const findPextArg = (args: string[]): string | null => {
    for (const raw of [...args].reverse()) {
        const normalized = normalizePextPath(raw)
        if (isPextFilePath(normalized)) return normalized
    }
    return null
}

export const checkForSingleInstance = async (): Promise<void> => {
    if (allowSecondInstance) {
        logger.main.info('Single instance: bypassed by PULSESYNC_ALLOW_SECOND_INSTANCE')
        await prestartCheck()
        return
    }

    logger.main.info('Single instance: ', isFirstInstance ? 'yes' : 'no')
    if (isFirstInstance) {
        const deeplinkCommandsHandler = await createDeeplinkCommandsHandler()

        if (process.platform === 'darwin') {
            app.on('open-url', (event, url) => {
                event.preventDefault()
                logger.main.info(`open-url event: ${url}`)
                void navigateToDeeplink(url, deeplinkCommandsHandler)
            })

            app.on('open-file', (event, filePath) => {
                event.preventDefault()
                logger.main.info(`open-file event: ${filePath}`)
                if (isPextFilePath(filePath)) {
                    void handlePextFile(filePath)
                }
            })
        }

        app.on('second-instance', async (_event: Electron.Event, commandLine: string[]) => {
            const [window] = BrowserWindow.getAllWindows()
            const deepLinkArg = findDeepLinkArg(commandLine)
            if (window) {
                if (window.isMinimized()) {
                    window.restore()
                    logger.main.info('Restore window')
                }
                if (deepLinkArg) {
                    await navigateToDeeplink(deepLinkArg, deeplinkCommandsHandler, window)
                }
                const pextPath = findPextArg(commandLine)
                if (pextPath) {
                    await handlePextFile(pextPath)
                }
                toggleWindowVisibility(window, true)
                logger.main.info('Show window')
            } else {
                if (deepLinkArg) {
                    await navigateToDeeplink(deepLinkArg, deeplinkCommandsHandler)
                }
                const pextPath = findPextArg(commandLine)
                if (pextPath) {
                    await handlePextFile(pextPath)
                }
            }
        })

        await prestartCheck()

        if (process.platform !== 'darwin') {
            const deepLinkArg = findDeepLinkArg(process.argv.slice(1))
            if (deepLinkArg) {
                await navigateToDeeplink(deepLinkArg, deeplinkCommandsHandler)
            }
            const pextPath = findPextArg(process.argv.slice(1))
            if (pextPath) {
                await handlePextFile(pextPath)
            }
        }
    } else {
        logger.main.info('Another instance is already running, quitting this instance.')
        app.quit()
    }
}

const toggleWindowVisibility = (window: BrowserWindow, isVisible: boolean) => {
    if (isVisible) {
        window.show()
    } else {
        window.hide()
    }
}

async function handlePextFile(filePath: string) {
    const addonName = await importPextFile(filePath)
    if (addonName) queueAddonOpen(addonName)
}
