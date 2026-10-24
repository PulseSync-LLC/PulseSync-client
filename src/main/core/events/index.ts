import os from 'node:os'

import { app, clipboard, ipcMain, Notification, session as electronSession, session } from 'electron'

import { installExtension, updateExtensions } from 'electron-chrome-web-store'
import path from 'path'

import { isDevmark } from '@common/appConfig'
import { DESKTOP_CORE_VERSION } from '@common/desktopRuntime/version'

import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { addMainBreadcrumb, captureMainException, setMainErrorTrackingUser } from '../../shared/errorTracking'
import { t } from '../../shared/i18n'
import logger from '../../shared/logger'
import {
    getBuildUpdateChannel,
    getEffectiveUpdateChannel,
    getUpdateChannelOverride,
    setUpdateChannelOverride,
} from '../../shared/updater/updateChannel'
import { getUpdateSource, setUpdateSource } from '../../shared/updater/updateSource'
import isAppDev from '../../shared/utils/isAppDev'
import { beginBrowserAuthFlow, cancelBrowserAuthFlow } from '../auth/browserAuth'
import { inSleepMode, mainWindow } from '../createWindow'
import { get_current_track, sendAuthorizationStatus } from '../httpServer'
import { refreshInstalledModState } from '../mod/integrity'
import { getModSourceSelection, normalizeModSourceSelection, setModSourceSelection } from '../mod/modSource'
import { getModBranchBuildSummaries, getModReleaseForSelection } from '../mod/network/releaseCatalog'
import { nativeGetHardwareIdentity } from '../nativeModules'
import { obsWidgetManager } from '../obsWidget/obsWidgetManager'
import { checkRendererUpdate, installRendererUpdate } from '../rendererUpdate'
import { isAllowedRemoteRendererUrl } from '../security/remoteRendererPolicy'
import { setAutoStartEnabled } from '../startup/loginItem'
import { updated } from '../startup/runtimeState'
import { getState } from '../state'
import { isUiReady, markUiReady } from '../uiReady'
import { UpdateStatus } from '../updater/constants/updateStatus'
import { CLIENT_REPO, listStableGitHubReleases, normalizeGitHubTagVersion } from '../updater/githubReleaseResolver'
import { getUpdater } from '../updater/updater'
import { isLinux, isMac } from '../utils/appUtils'
import { registerAddonPackageEvents } from './addonPackageEvents'
import { registerLogArchiveEvent, registerLoggingEvents } from './diagnosticsEvents'
import { registerMusicStatusEvents, registerYandexMusicEvents } from './musicEvents'
import { registerShellEvents } from './shellEvents'

import type { DesktopSetUpdateChannelOverrideRequest } from '../../../common/desktopApi/contract'
import type { BrowserWindow } from 'electron'

const updater = getUpdater()
const State = getState()
let reqModal = 0
export let updateAvailable = false
export let authorized = false
let pendingAddonOpen: string | null = null
let updaterStartListenerBound = false
const MOD_REPO = {
    owner: 'PulseSync-LLC',
    repo: 'PulseSync-mod',
} as const
const REMOTE_RENDERER_CACHE_MISS_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf'])

const toUnixSeconds = (dateValue: string | null | undefined): number => {
    if (!dateValue) {
        return 0
    }

    const timestamp = new Date(dateValue).getTime()
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0
}

const getCurrentUpdateStatus = () => updater.getStatus()

const ensureUpdateSourceSwitchAllowed = () => {
    const status = getCurrentUpdateStatus()
    if (status === UpdateStatus.CHECKING || status === UpdateStatus.DOWNLOADING) {
        throw new Error('UPDATE_SOURCE_BUSY')
    }
}

function launchExtensionBackgroundWorkers(session = electronSession.defaultSession) {
    return Promise.all(
        session.extensions.getAllExtensions().map(async extension => {
            const manifest = extension.manifest
            if (manifest.manifest_version === 3 && manifest?.background?.service_worker) {
                await session.serviceWorkers.startWorkerForScope(extension.url)
            }
        }),
    )
}

function isRemoteRendererCacheMiss(details: Electron.OnErrorOccurredListenerDetails): boolean {
    if (details.error !== 'net::ERR_CACHE_MISS') {
        return false
    }

    try {
        const url = new URL(details.url)
        if (url.hostname !== 'pulsesync.dev' || !/^\/app\/[^/]+\/versions\//u.test(url.pathname)) {
            return false
        }

        return REMOTE_RENDERER_CACHE_MISS_EXTENSIONS.has(path.extname(url.pathname).toLowerCase())
    } catch {
        return false
    }
}

function getRemoteRendererResourceUrl(rawUrl: string): string | null {
    if (!isAllowedRemoteRendererUrl(rawUrl, false)) return null
    const url = new URL(rawUrl)
    if (!/\/versions\/\d+\/assets\/.*\.(?:css|js)$/u.test(url.pathname)) return null
    return `${url.origin}${url.pathname}`
}

async function registerAppReadyEvents(): Promise<void> {
    const filter = { urls: ['*://pulsesync.dev/*', '*://*.pulsesync.dev/*', 'https://pulsesync-llc.github.io/PulseSync-renderer/app/*'] }
    session.defaultSession.webRequest.onErrorOccurred(filter, details => {
        const resourceUrl = getRemoteRendererResourceUrl(details.url)
        if (resourceUrl) {
            addMainBreadcrumb('pulsesync.renderer.resource', 'Remote renderer resource request failed', {
                url: resourceUrl,
                requestId: details.id,
                resourceType: details.resourceType,
                error: details.error,
                fromCache: details.fromCache,
            })
            if (details.resourceType === 'stylesheet' && details.error !== 'net::ERR_ABORTED') {
                captureMainException(
                    new Error(`Remote renderer stylesheet request failed (${details.error}): ${resourceUrl}`),
                    'renderer/stylesheet',
                )
            }
        }
        if (isRemoteRendererCacheMiss(details)) {
            logger.http.debug(`HTTP CACHE MISS: ${details.method} ${details.url} (from ${details.webContentsId})`)
            return
        }

        logger.http.error(`HTTP ERROR: ${details.error} — ${details.method} ${details.url} (from ${details.webContentsId})`)
    })
    session.defaultSession.webRequest.onCompleted(filter, details => {
        const resourceUrl = getRemoteRendererResourceUrl(details.url)
        if (!resourceUrl || (details.resourceType !== 'stylesheet' && details.statusCode < 400)) return
        const headers = Object.fromEntries(
            Object.entries(details.responseHeaders ?? {}).map(([name, values]) => [name.toLowerCase(), values.join(', ')]),
        )
        addMainBreadcrumb('pulsesync.renderer.resource', 'Remote renderer resource response', {
            url: resourceUrl,
            requestId: details.id,
            resourceType: details.resourceType,
            statusCode: details.statusCode,
            fromCache: details.fromCache,
            contentType: headers['content-type'],
            contentEncoding: headers['content-encoding'],
            contentLength: headers['content-length'],
            rayId: headers['cf-ray'],
        })
        if (details.resourceType === 'stylesheet' && details.statusCode >= 400) {
            captureMainException(
                new Error(`Remote renderer stylesheet request failed (HTTP ${details.statusCode}): ${resourceUrl}`),
                'renderer/stylesheet',
            )
        }
    })
    if (isAppDev) {
        try {
            await installExtension('fmkadmapgofadopljbjfkapdkoienihi')
            await updateExtensions()
            await launchExtensionBackgroundWorkers()
        } catch (e) {
            logger.main.error(e)
        }
    }
}

export const queueAddonOpen = (addonName: string): void => {
    pendingAddonOpen = addonName
    tryOpenPendingAddon()
}

const tryOpenPendingAddon = (): void => {
    if (!authorized || !isUiReady() || !pendingAddonOpen || !mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(RendererEvents.OPEN_ADDON, pendingAddonOpen)
    pendingAddonOpen = null
}

const registerWindowEvents = (): void => {
    ipcMain.handle(MainEvents.ELECTRON_WINDOW_IS_MAXIMIZED, () => mainWindow.isMaximized())

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send(MainEvents.ELECTRON_WINDOW_MAXIMIZED)
    })

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send(MainEvents.ELECTRON_WINDOW_UNMAXIMIZED)
    })

    ipcMain.on(MainEvents.ELECTRON_WINDOW_MINIMIZE, () => {
        mainWindow.minimize()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_EXIT, () => {
        logger.main.info(t('main.events.exitApp'))
        app.quit()
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_MAXIMIZE, () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize()
        } else {
            mainWindow.maximize()
        }
    })
    ipcMain.on(MainEvents.ELECTRON_WINDOW_CLOSE, (_event, val: boolean) => {
        if (val) {
            mainWindow.hide()
            return
        }

        app.quit()
    })
}

const registerSystemEvents = (window: BrowserWindow): void => {
    ipcMain.handle(MainEvents.WRITE_CLIPBOARD_TEXT, (event, text: unknown) => {
        if (event.sender.id !== window.webContents.id) {
            throw new Error('Blocked clipboard write from an untrusted renderer')
        }
        if (typeof text !== 'string') {
            throw new TypeError('Clipboard text must be a string')
        }

        clipboard.writeText(text)
    })
    ipcMain.on(MainEvents.ELECTRON_ISDEV, event => {
        event.returnValue = isAppDev || isDevmark
    })
    ipcMain.on(MainEvents.ELECTRON_ISMAC, async event => {
        event.returnValue = isMac()
    })
    ipcMain.on(MainEvents.ELECTRON_ISLINUX, async event => {
        event.returnValue = isLinux()
    })
    ipcMain.on(MainEvents.GET_CLIENT_HARDWARE_IDENTITY, event => {
        event.returnValue = nativeGetHardwareIdentity()
    })
    ipcMain.handle(MainEvents.GET_BUILD_CHANNEL, async () => getBuildUpdateChannel())
    ipcMain.handle(MainEvents.GET_EFFECTIVE_UPDATE_CHANNEL, async () => getEffectiveUpdateChannel())
    ipcMain.handle(MainEvents.GET_UPDATE_CHANNEL_OVERRIDE, async () => getUpdateChannelOverride())
    ipcMain.handle(MainEvents.GET_UPDATE_SOURCE, async () => getUpdateSource())
    ipcMain.handle(MainEvents.GET_UPDATE_STATUS, async () => getCurrentUpdateStatus())
    ipcMain.handle(MainEvents.GET_MOD_RELEASES, async () => {
        const stableSource = getUpdateSource()
        const selection = getModSourceSelection()
        const release = await getModReleaseForSelection(selection, stableSource)
        return release ? [release] : []
    })
    ipcMain.handle(MainEvents.GET_INSTALLED_MOD_STATE, () => refreshInstalledModState())
    ipcMain.handle(MainEvents.GET_MOD_SOURCES, async () => {
        const branches = await getModBranchBuildSummaries()
        const selected = getModSourceSelection()

        return { branches, selected }
    })
    ipcMain.handle(MainEvents.SET_MOD_SOURCE, async (_event, value) => {
        const selection = normalizeModSourceSelection(value)
        if (!selection) throw new Error('INVALID_MOD_SOURCE')

        const release = await getModReleaseForSelection(selection, getUpdateSource())
        if (!release) throw new Error('MOD_SOURCE_UNAVAILABLE')

        return {
            release,
            selection: setModSourceSelection(selection),
        }
    })
    ipcMain.handle(MainEvents.GET_CLIENT_CHANGELOG, async () => {
        const releases = await listStableGitHubReleases(CLIENT_REPO)

        return releases.map(release => ({
            id: release.id,
            version: normalizeGitHubTagVersion(release.tag_name),
            changelog: release.body ?? '',
            createdAt: toUnixSeconds(release.published_at),
        }))
    })
    ipcMain.handle(MainEvents.GET_MOD_CHANGELOG, async () => {
        const releases = await listStableGitHubReleases(MOD_REPO)

        return releases.map(release => ({
            id: String(release.id),
            version: normalizeGitHubTagVersion(release.tag_name),
            description: release.body ?? '',
            createdAt: toUnixSeconds(release.published_at),
        }))
    })
    ipcMain.handle(MainEvents.SET_UPDATE_CHANNEL_OVERRIDE, async (_event, request: DesktopSetUpdateChannelOverrideRequest | string | null) => {
        const isLegacyRequest = typeof request === 'string' || request === null
        const channel = isLegacyRequest ? request : request.channel
        const allowDevToBetaSwitch = !isLegacyRequest && request.allowDevToBetaSwitch === true
        const previousEffectiveChannel = getEffectiveUpdateChannel()
        const nextOverride = setUpdateChannelOverride(channel, allowDevToBetaSwitch)
        const nextEffectiveChannel = getEffectiveUpdateChannel()

        if (previousEffectiveChannel !== nextEffectiveChannel) {
            await updater.clearPendingUpdate(`channel-switch:${previousEffectiveChannel}->${nextEffectiveChannel}`)
            updateAvailable = false
        }

        updater.reloadFeed()

        return {
            buildChannel: getBuildUpdateChannel(),
            overrideChannel: nextOverride,
            effectiveChannel: nextEffectiveChannel,
        }
    })
    ipcMain.handle(MainEvents.SET_UPDATE_SOURCE, async (_event, source: string | null) => {
        ensureUpdateSourceSwitchAllowed()

        const previousSource = getUpdateSource()
        const nextSource = setUpdateSource(source)

        if (previousSource !== nextSource) {
            await updater.clearPendingUpdate(`source-switch:${previousSource}->${nextSource}`)
            updateAvailable = false
        }

        updater.reloadFeed()
        if (previousSource !== nextSource) {
            await checkRendererUpdate()
        }

        return {
            source: nextSource,
        }
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_GET, (event, val) => {
        event.returnValue = State.get(val)
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_SET, (_event, key, val) => {
        State.set(key, val)
    })
    ipcMain.on(MainEvents.ELECTRON_STORE_DELETE, (_event, key) => {
        State.delete(key)
    })
    ipcMain.handle(MainEvents.MARK_APP_PATCH_NOTES_SEEN, (_event, ids: unknown) => {
        if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) throw new Error('Invalid patch note IDs')
        const storedIds: unknown = State.get('app.seenAppPatchNotes')
        const seenIds = Array.isArray(storedIds) ? storedIds.filter((id): id is string => typeof id === 'string') : []
        State.set('app.seenAppPatchNotes', [...new Set([...seenIds, ...ids])])
    })
    ipcMain.handle(MainEvents.SET_STORE_RELEASE_CHANNEL, (_event, channel: unknown) => {
        if (channel !== 'stable' && channel !== 'dev') throw new Error('Invalid store release channel')
        State.set('settings.storeReleaseChannel', channel)
    })
    ipcMain.handle(MainEvents.GET_SYSTEM_INFO, async () => ({
        appVersion: DESKTOP_CORE_VERSION,
        osType: os.type(),
        osRelease: os.release(),
        cpu: os.cpus(),
        memory: os.totalmem(),
        freeMemory: os.freemem(),
        arch: os.arch(),
    }))
    ipcMain.on(MainEvents.UI_READY, () => {
        markUiReady()
        tryOpenPendingAddon()
        get_current_track()
    })
}

const registerAutoStartEvent = (): void => {
    ipcMain.on(MainEvents.AUTO_START_APP, (_event, enabled: boolean) => {
        setAutoStartEnabled(enabled)
    })
}

const registerUpdateEvents = (): void => {
    ipcMain.on(MainEvents.UPDATE_INSTALL, async () => {
        if (updater.getStatus() === UpdateStatus.DOWNLOADED) {
            await updater.install()
            return
        }
        if (!(await installRendererUpdate()) && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(RendererEvents.DOWNLOAD_UPDATE_FAILED, { phase: 'install', code: 'renderer-install-failed' })
        }
    })

    ipcMain.on(MainEvents.CHECK_UPDATE, async (_event, args: { hard?: boolean; manual?: boolean }) => {
        updater.reloadFeed()
        await checkOrFindUpdate(args?.hard, args?.manual)
    })

    ipcMain.on(MainEvents.UPDATER_START, async () => {
        updater.start()
        if (!updaterStartListenerBound) {
            updaterStartListenerBound = true
            updater.onUpdate(version => {
                mainWindow.webContents.send(RendererEvents.UPDATE_AVAILABLE, { kind: 'client', version })
                updateAvailable = true
            })
        }
        if (updater.getStatus() === UpdateStatus.DOWNLOADED) await updater.check(true)
    })
}

const registerAuthEvents = (): void => {
    ipcMain.on(MainEvents.AUTH_STATUS, (_event, data: any) => {
        authorized = data.status
        setMainErrorTrackingUser(data.status ? data.user : null)
        sendAuthorizationStatus(authorized)
        tryOpenPendingAddon()
    })
    ipcMain.handle(MainEvents.START_BROWSER_AUTH, async () => {
        beginBrowserAuthFlow()
        return { success: true }
    })
    ipcMain.handle(MainEvents.CANCEL_BROWSER_AUTH, async () => {
        cancelBrowserAuthFlow()
        State.delete('tokens.token')
        authorized = false
        sendAuthorizationStatus(false)
        return { success: true }
    })
}

const registerNotificationEvents = (): void => {
    ipcMain.on(MainEvents.SHOW_NOTIFICATION, (_event, data: any) => {
        new Notification({ title: data.title, body: data.body }).show()
    })
    ipcMain.handle(MainEvents.NEED_MODAL_UPDATE, async () => {
        if (reqModal <= 0) {
            reqModal++
            return updated
        }
        return false
    })
}

const registerSleepModeEvent = (): void => {
    ipcMain.handle(MainEvents.CHECK_SLEEP_MODE, async () => inSleepMode)
}

export const handleEvents = (window: BrowserWindow): void => {
    registerWindowEvents()
    registerAppReadyEvents()
    registerSystemEvents(window)
    registerShellEvents()
    registerAutoStartEvent()
    registerMusicStatusEvents()
    registerUpdateEvents()
    registerAuthEvents()
    registerLoggingEvents()
    registerNotificationEvents()
    registerLogArchiveEvent()
    registerSleepModeEvent()
    registerAddonPackageEvents({ isAuthorized: () => authorized, queueAddonOpen })
    registerYandexMusicEvents(window)
    obsWidgetManager(window, app)
}

export const checkOrFindUpdate = async (hard?: boolean, manual = false) => {
    logger.updater.info('Check update')
    const status = await updater.check(manual, { suppressUpToDateEvent: true })
    if (status === UpdateStatus.DOWNLOADED) {
        if (hard) await updater.install()
        updateAvailable = true
    } else if (status === UpdateStatus.DOWNLOADING) {
        updateAvailable = true
    } else if (status === UpdateStatus.IDLE || status === null) {
        updateAvailable = false
        const rendererUpdateAvailable = await checkRendererUpdate()
        if (!rendererUpdateAvailable && status === null) {
            mainWindow.webContents.send(RendererEvents.CHECK_UPDATE, { updateAvailable: false, manual })
        }
    }
}
