import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, powerMonitor, screen, shell } from 'electron'

import path from 'path'

import config from '@common/appConfig'
import { isDevmark } from '@common/appConfig'

import { queueAddonOpen, updateAvailable } from '../events'
import { isWindows } from '../utils/appUtils'
import { getNativeImg } from '../utils/electronNative'
import isAppDev from '../utils/isAppDev'
import { refreshRemoteLocalization } from './localization'
import logger from './logger'
import { getPulseSyncUserAgent } from './mod/network/userAgent'
import { importPextFile, isPextFilePath } from './pextImporter'
import { type MainRendererSource, resolveMainRendererSources } from './rendererSource'
import { startRendererUpdateMonitor, stopRendererUpdateMonitor } from './rendererUpdate'
import {
    buildRemoteRendererContentSecurityPolicy,
    getRemoteRendererUrlPattern,
    getUrlOrigin,
    isAllowedRemoteRendererNavigation,
    isAllowedRemoteRendererWindowOpen,
    shouldAllowDevRemoteRenderer,
} from './security/remoteRendererPolicy'
import { getState } from './state'
import { getUpdater } from './updater/updater'

const State = getState()

export let mainWindow: BrowserWindow
export let inSleepMode = false
let isAppQuitting = false

const minMain = { width: 1400, height: 850 }

app.on('before-quit', () => {
    isAppQuitting = true
})

const isWithinDisplayBounds = (pos: { x: number; y: number }, display: Electron.Display) => {
    const area = display.workArea
    return pos.x >= area.x && pos.y >= area.y && pos.x < area.x + area.width && pos.y < area.y + area.height
}

const resolveDroppedPextPath = (navigationUrl: string): string | null => {
    try {
        const parsed = new URL(navigationUrl)
        if (parsed.protocol !== 'file:') return null
        const filePath = path.normalize(fileURLToPath(parsed))
        return isPextFilePath(filePath) ? filePath : null
    } catch {
        return null
    }
}

const importDroppedPext = (url: string): boolean => {
    const droppedPextPath = resolveDroppedPextPath(url)
    if (!droppedPextPath) return false

    void (async () => {
        const addonName = await importPextFile(droppedPextPath)
        if (addonName) {
            queueAddonOpen(addonName)
        }
    })()
    return true
}

const getMainWindowPreloadPath = (): string => {
    return path.join(__dirname, 'mainWindowPreload.cjs')
}

const registerRemoteMainWindowSecurity = (window: BrowserWindow): void => {
    const mainWebContentsId = window.webContents.id
    window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
        if (webContents.id === mainWebContentsId) {
            logger.main.warn('Blocked remote renderer permission request', { permission, requestingUrl: details.requestingUrl })
        }
        callback(false)
    })
    window.webContents.session.setPermissionCheckHandler(() => false)
    window.webContents.on('will-attach-webview', event => {
        event.preventDefault()
        logger.main.warn('Blocked remote renderer webview attachment')
    })
}

interface RemotePreloadSurfaceProbe {
    appInfo: string
    desktopEvents: string
    electron: string
    pulsesyncDesktop: string
}

const withOverriddenResponseHeaders = (
    responseHeaders: Record<string, string[]> | undefined,
    overriddenHeaders: Record<string, string[]>,
): Record<string, string[]> => {
    const overrideNames = new Set(Object.keys(overriddenHeaders).map(name => name.toLowerCase()))
    const preservedHeaders = Object.fromEntries(Object.entries(responseHeaders || {}).filter(([name]) => !overrideNames.has(name.toLowerCase())))

    return {
        ...preservedHeaders,
        ...overriddenHeaders,
    }
}

const assertRemotePreloadSurface = async (window: BrowserWindow): Promise<void> => {
    const surface = (await window.webContents.executeJavaScript(
        `(() => ({
            pulsesyncDesktop: typeof window.pulsesyncDesktop,
            electron: typeof window.electron,
            appInfo: typeof window.appInfo,
            desktopEvents: typeof window.desktopEvents
        }))()`,
        true,
    )) as RemotePreloadSurfaceProbe

    const hasDesktopApi = surface.pulsesyncDesktop === 'object' || surface.pulsesyncDesktop === 'function'
    if (!hasDesktopApi) {
        throw new Error('Remote preload did not expose window.pulsesyncDesktop')
    }

    const exposedLegacyGlobals = (['electron', 'appInfo', 'desktopEvents'] as const).filter(key => surface[key] !== 'undefined')
    if (exposedLegacyGlobals.length) {
        throw new Error(`Remote preload exposed legacy globals: ${exposedLegacyGlobals.join(', ')}`)
    }

    logger.main.info('Remote preload surface verified')
}

const registerRemoteRendererResponseHeaders = (window: BrowserWindow, activeRemoteOrigin: string): void => {
    const allowDevRemoteRenderer = shouldAllowDevRemoteRenderer(isAppDev, isDevmark)
    const csp = buildRemoteRendererContentSecurityPolicy(allowDevRemoteRenderer, `http://127.0.0.1:${config.MAIN_PORT}`)
    const apiOrigins = Array.from(
        new Set([config.SERVER_URL, config.SERVER_v2_URL].map(rawUrl => getUrlOrigin(rawUrl)).filter((origin): origin is string => Boolean(origin))),
    )
    const apiUrlPatterns = apiOrigins.map(origin => getRemoteRendererUrlPattern(origin))
    const apiCorsRequestHeaders = new Map<number, string>()
    const devCacheHeaders: Record<string, string[]> = allowDevRemoteRenderer
        ? {
              'Cache-Control': ['no-store'],
              Pragma: ['no-cache'],
          }
        : {}

    window.webContents.session.webRequest.onBeforeSendHeaders({ urls: apiUrlPatterns }, (details, callback) => {
        const userAgentHeader = Object.keys(details.requestHeaders).find(header => header.toLowerCase() === 'user-agent') ?? 'User-Agent'
        details.requestHeaders[userAgentHeader] = getPulseSyncUserAgent()

        const requestOrigin = details.requestHeaders.Origin || details.requestHeaders.origin
        if (requestOrigin === activeRemoteOrigin) {
            const requestedHeaders =
                details.requestHeaders['Access-Control-Request-Headers'] || details.requestHeaders['access-control-request-headers']
            if (typeof requestedHeaders === 'string' && requestedHeaders.trim()) {
                apiCorsRequestHeaders.set(details.id, requestedHeaders)
            }
        }

        callback({ requestHeaders: details.requestHeaders })
    })

    window.webContents.session.webRequest.onHeadersReceived(
        { urls: [getRemoteRendererUrlPattern(activeRemoteOrigin), ...apiUrlPatterns] },
        (details, callback) => {
            const detailsOrigin = getUrlOrigin(details.url)
            const isRemoteRendererResponse = detailsOrigin === activeRemoteOrigin
            const isApiResponse = Boolean(detailsOrigin && apiOrigins.includes(detailsOrigin))

            if (!isRemoteRendererResponse && !isApiResponse) {
                callback({ responseHeaders: details.responseHeaders })
                return
            }

            const corsHeaders: Record<string, string[]> = isApiResponse
                ? {
                      'Access-Control-Allow-Origin': [activeRemoteOrigin],
                      'Access-Control-Allow-Credentials': ['true'],
                      'Access-Control-Allow-Methods': ['GET, POST, PUT, PATCH, DELETE, OPTIONS'],
                      'Access-Control-Allow-Headers': [apiCorsRequestHeaders.get(details.id) || 'Authorization, Content-Type, Accept'],
                      Vary: ['Origin, Access-Control-Request-Headers'],
                  }
                : {}
            apiCorsRequestHeaders.delete(details.id)

            callback({
                responseHeaders: withOverriddenResponseHeaders(details.responseHeaders, {
                    ...corsHeaders,
                    ...(isRemoteRendererResponse
                        ? {
                              ...devCacheHeaders,
                              'Content-Security-Policy': [csp],
                              'Cross-Origin-Opener-Policy': ['same-origin'],
                              'Referrer-Policy': ['no-referrer'],
                              'X-Content-Type-Options': ['nosniff'],
                              'X-Frame-Options': ['DENY'],
                          }
                        : {}),
                }),
            })
        },
    )
    logger.main.info('Remote renderer response headers enforced', { origin: activeRemoteOrigin })
}

const loadMainWindowRenderer = async (window: BrowserWindow, resolvedSource?: MainRendererSource): Promise<MainRendererSource> => {
    const sources = resolvedSource ? [resolvedSource] : resolveMainRendererSources()
    let lastError: unknown
    let sourceIndex = 0

    for await (const source of sources) {
        try {
            if (isAppDev) {
                await window.webContents.session.clearCache()
            }
            await refreshRemoteLocalization(source)
            registerRemoteRendererResponseHeaders(window, source.origin)
            await window.loadURL(source.url)
            await assertRemotePreloadSurface(window)
            if (sourceIndex > 0) {
                logger.main.warn('Remote renderer fallback selected', {
                    buildNumber: source.manifest.buildNumber,
                    url: source.url,
                })
            }
            return source
        } catch (error) {
            lastError = error
            logger.main.warn('Failed to load remote renderer candidate', {
                url: source.url,
                message: error instanceof Error ? error.message : String(error),
            })
            sourceIndex += 1
        }
    }

    logger.main.error('Failed to load all remote renderer candidates', lastError)
    throw lastError instanceof Error ? lastError : new Error('Failed to load all remote renderer candidates')
}

export type MainWindowStartupHandle = {
    ready: Promise<void>
    window: BrowserWindow
}

export async function createWindow(options: { bootstrapWindow?: BrowserWindow } = {}): Promise<MainWindowStartupHandle> {
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
    const iconExt = isWindows() ? '.ico' : '.png'
    const icon = getNativeImg('App', iconExt, 'icon').resize({ width: 40, height: 40 })
    mainWindow = new BrowserWindow({
        show: false,
        frame: false,
        backgroundColor: '#16181E',
        width: dimensions?.width ?? minMain.width,
        height: dimensions?.height ?? minMain.height,
        ...(position ? { x: position.x, y: position.y } : { center: true }),
        minWidth: minMain.width,
        minHeight: minMain.height,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 15, y: 18 },
        icon,
        webPreferences: {
            preload: getMainWindowPreloadPath(),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: isAppDev || isDevmark,
        },
    })
    registerRemoteMainWindowSecurity(mainWindow)
    const rendererWindow = mainWindow
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
        logger.main.error('Main window preload failed', { preloadPath, error })
    })

    let resolveReady!: () => void
    const ready = new Promise<void>(resolve => {
        resolveReady = resolve
    })
    let mainWindowReadyHandled = false
    const handleMainWindowReady = () => {
        if (mainWindowReadyHandled) {
            return
        }
        mainWindowReadyHandled = true
        if (options.bootstrapWindow && !options.bootstrapWindow.isDestroyed()) {
            options.bootstrapWindow.destroy()
        }
        if (!State.get('settings.autoStartInTray')) {
            mainWindow.show()
            mainWindow.moveTop()
        }
        resolveReady()
    }
    let mainRendererSource: MainRendererSource | null = null
    let rendererRetryTimer: NodeJS.Timeout | null = null
    const activateMainRenderer = async (source: MainRendererSource): Promise<void> => {
        const previousSource = mainRendererSource
        try {
            mainRendererSource = await loadMainWindowRenderer(rendererWindow, source)
        } catch (error) {
            if (previousSource) {
                logger.main.warn('Restoring previous renderer after update failure', { buildNumber: previousSource.manifest.buildNumber })
                mainRendererSource = await loadMainWindowRenderer(rendererWindow, previousSource)
            }
            throw error
        }
    }
    const loadMainRenderer = async (): Promise<void> => {
        try {
            const source = await loadMainWindowRenderer(rendererWindow)
            mainRendererSource = source
            logger.main.info('Main renderer loaded', { source: source.kind })
            startRendererUpdateMonitor({
                activate: activateMainRenderer,
                getActiveSource: () => mainRendererSource,
                window: rendererWindow,
            })
            handleMainWindowReady()
        } catch (error) {
            logger.main.error('Failed to load main renderer; keeping bootstrap window visible', error)
            if (!rendererWindow.isDestroyed()) {
                rendererRetryTimer = setTimeout(() => void loadMainRenderer(), 5000)
                rendererRetryTimer.unref()
            }
        }
    }
    void loadMainRenderer()
    rendererWindow.once('closed', () => {
        if (rendererRetryTimer) clearTimeout(rendererRetryTimer)
        stopRendererUpdateMonitor()
    })

    mainWindow.webContents.on('before-input-event', (e, input) => {
        if (input.control && (input.key === '+' || input.key === '-')) {
            e.preventDefault()
        }
    })

    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (importDroppedPext(navigationUrl)) {
            event.preventDefault()
            return
        }

        if (mainRendererSource && !isAllowedRemoteRendererNavigation(navigationUrl, mainRendererSource.origin)) {
            event.preventDefault()
            logger.main.warn('Blocked remote renderer navigation', { navigationUrl })
            return
        }
    })

    mainWindow.webContents.setWindowOpenHandler(data => {
        const url = data.url
        if (importDroppedPext(url)) {
            return { action: 'deny' }
        }

        if (mainRendererSource) {
            if (!isAllowedRemoteRendererWindowOpen(url, mainRendererSource.origin)) {
                logger.main.warn('Blocked remote renderer window open', { url })
                return { action: 'deny' }
            }

            shell.openExternal(url)
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

    mainWindow.on('close', event => {
        if (!isAppQuitting && State.get('settings.closeAppInTray')) {
            event.preventDefault()
            mainWindow.hide()
            return
        }

        const bounds = mainWindow.getBounds()
        const disp = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y })
        State.set('settings.lastDisplayId', disp.id)
    })

    powerMonitor.on('suspend', () => {
        inSleepMode = true
    })
    powerMonitor.on('resume', () => {
        if (inSleepMode && updateAvailable) {
            getUpdater().install()
        }
        inSleepMode = false
    })

    return { ready, window: mainWindow }
}
