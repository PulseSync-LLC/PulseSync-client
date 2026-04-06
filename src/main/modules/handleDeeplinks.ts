import { BrowserWindow } from 'electron'
import deeplinkCommands from './deeplinkCommands'
import logger from './logger'
import { BrowserAuthCredentials, extractBrowserAuthFromDeepLink, processBrowserAuth } from './auth/browserAuth'
import { extractInstallModUpdateFromDeepLink, installModUpdateFromAsar } from './mod/installModUpdateFrom'
import { isUiReady, runWhenUiReady } from './uiReady'

let pendingInstallModUpdateFrom: { path: string; source: 'deeplink' } | null = null
let pendingBrowserAuthFromDeepLink: BrowserAuthCredentials | null = null

const trimQuotes = (value: string): string => value.trim().replace(/^["']|["']$/g, '')

const transformUrl = (url: string): string[] => {
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'pulsesync:') return []

        return [parsed.hostname, ...parsed.pathname.split('/')].map(part => trimQuotes(part || '')).filter(Boolean)
    } catch {
        return url
            .replace(/^pulsesync:\/\//i, '')
            .split('/')
            .map(part => trimQuotes(part.split(/[?#]/, 1)[0] || ''))
            .filter(Boolean)
    }
}

export const checkIsDeeplink = (value: string): boolean => /^pulsesync:\/\/.*/i.test(value)

export const findDeepLinkArg = (args: string[]): string | null => {
    for (const raw of [...args].reverse()) {
        const normalized = trimQuotes(raw || '')
        if (checkIsDeeplink(normalized)) return normalized
    }
    return null
}

export const consumePendingInstallModUpdateFromPath = (): { path: string; source: 'deeplink' } | null => {
    const value = pendingInstallModUpdateFrom
    pendingInstallModUpdateFrom = null
    return value
}

export const consumePendingBrowserAuthFromDeepLink = (): BrowserAuthCredentials | null => {
    const value = pendingBrowserAuthFromDeepLink
    pendingBrowserAuthFromDeepLink = null
    return value
}

const handleInstallModUpdateFrom = async (asarPath: string, window?: BrowserWindow): Promise<void> => {
    const resolveTargetWindow = (): BrowserWindow | undefined => {
        if (window && !window.isDestroyed()) return window
        return BrowserWindow.getAllWindows()[0]
    }

    const targetWindow = resolveTargetWindow()
    if (!targetWindow) {
        pendingInstallModUpdateFrom = { path: asarPath, source: 'deeplink' }
        logger.main.info(`Queued INSTALL_MOD_UPDATE_FROM from deeplink: ${asarPath}`)
        return
    }

    const startInstall = () => {
        const installWindow = resolveTargetWindow()
        if (!installWindow) {
            pendingInstallModUpdateFrom = { path: asarPath, source: 'deeplink' }
            logger.main.info(`Re-queued INSTALL_MOD_UPDATE_FROM until window is available: ${asarPath}`)
            return
        }

        void installModUpdateFromAsar(asarPath, installWindow, 'deeplink').then(result => {
            if (!result.success) {
                logger.main.warn('INSTALL_MOD_UPDATE_FROM failed from deeplink:', result)
            }
        })
    }

    if (!isUiReady()) {
        runWhenUiReady(startInstall)
        logger.main.info(`Queued INSTALL_MOD_UPDATE_FROM until UI_READY: ${asarPath}`)
        return
    }

    startInstall()
}

const handleBrowserAuthDeepLink = async (credentials: BrowserAuthCredentials, window?: BrowserWindow): Promise<void> => {
    const targetWindow = window ?? BrowserWindow.getAllWindows()[0]
    if (!targetWindow) {
        pendingBrowserAuthFromDeepLink = credentials
        logger.main.info(`Queued BROWSER_AUTH from deeplink for userId=${credentials.userId}`)
        return
    }

    await processBrowserAuth(credentials, { window: targetWindow })
}

export const createDeeplinkCommandsHandler = async (): Promise<deeplinkCommands> => {
    return new deeplinkCommands({
        handleBrowserAuth: handleBrowserAuthDeepLink,
        handleInstallModUpdateFrom,
    })
}

export const navigateToDeeplink = async (url: string, deeplinkCommandsHandler: deeplinkCommands, window?: BrowserWindow): Promise<void> => {
    if (!url) return

    const args = transformUrl(url)
    const commandName = args.shift()
    if (commandName) {
        const commandHandled = await deeplinkCommandsHandler.runCommand(commandName, args, url, window)
        if (commandHandled) return
    }

    const browserAuth = extractBrowserAuthFromDeepLink(url)
    if (browserAuth) {
        await handleBrowserAuthDeepLink(browserAuth, window)
        return
    }

    const asarPath = extractInstallModUpdateFromDeepLink(url)
    if (asarPath) {
        await handleInstallModUpdateFrom(asarPath, window)
        return
    }

    logger.main.warn(`Unhandled deeplink command: ${url}`)
}
