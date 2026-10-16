import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from 'electron'

import path from 'path'
import process from 'process'

import RendererEvents from '../../common/types/rendererEvents'
import { HandleErrorsElectron } from '../shared/handlers/handleErrorsElectron'
import { initMainI18n, t } from '../shared/i18n'
import logger from '../shared/logger'
import isAppDev from '../shared/utils/isAppDev'
import { processBrowserAuth } from './auth/browserAuth'
import { migrateCompletedLaunchRequestIds, writeCompletedLaunchRequestIds } from './bootstrap/launchCompletionStore'
import { createWindow, mainWindow } from './createWindow'
import { handleEvents } from './events'
import { registerAddonEvents } from './events/addonEvents'
import { registerFileEvents } from './events/fileEvents'
import { registerLocalizationIpc } from './localization'
import { installModUpdateFromAsar } from './mod/installModUpdateFrom'
import { modManager } from './mod/modManager'
import { enableSystemProxySupport } from './network/systemProxy'
import {
    consumePendingBrowserAuthFromDeepLink,
    consumePendingInstallModUpdateFromPath,
    createApplicationLaunchRequestHandler,
    setIsFirstInstance,
} from './singleInstance'
import { prestartCheck } from './startup/prestartCheck'
import { setMusicPath, setUpdated } from './startup/runtimeState'
import { getState } from './state'
import { sendAppStartupTelemetry } from './telemetry/appTelemetry'
import createTray from './tray'
import { runWhenUiReady } from './uiReady'
import { configureUpdaterBootstrapRuntime, type UpdaterBootstrapRuntime } from './updater/updater'
import { findAppByName, getPathToYandexMusic, isMac, isWindows } from './utils/appUtils'
import { checkCLIArguments } from './utils/processUtils'

import type { LaunchRequestEnvelopeV1 } from '../shared/bootstrapper/contracts'
import type { BootstrapUiController } from '@common/types/bootstrapEvents'

const State = getState()
initMainI18n(State.get('settings.language'))
registerLocalizationIpc()

const registerPulseSyncProtocol = (): void => {
    try {
        const entryFile = process.argv[1]
        const isDevProtocolRegistration = Boolean(process.defaultApp || (isAppDev && entryFile))
        if (isDevProtocolRegistration && entryFile) {
            app.setAsDefaultProtocolClient('pulsesync', process.execPath, [path.resolve(entryFile)])
        } else {
            app.setAsDefaultProtocolClient('pulsesync')
        }
    } catch (error) {
        logger.main.warn('Failed to register pulsesync:// protocol handler:', error)
    }
}

registerPulseSyncProtocol()

const checkOldYandexMusic = async () => {
    try {
        const namePart = 'Yandex.Music'
        const pkg = await findAppByName(namePart)

        if (pkg && mainWindow && !mainWindow.isDestroyed()) {
            logger.main.info('Old Yandex Music found, sending dialog event to renderer')
            mainWindow.webContents.send(RendererEvents.SHOW_YANDEX_MUSIC_UPDATE_DIALOG)
        }
    } catch (err) {
        logger.main.warn('Unable to check old Yandex Music AppX package:', err)
    }
}

const initializeMusicPath = async () => {
    try {
        setMusicPath(await getPathToYandexMusic())
    } catch (err) {
        logger.main.error(t('main.index.musicPathError'), err)
    }
}
export type ApplicationStartupContext = {
    bootstrapRuntime?: UpdaterBootstrapRuntime
    bootstrapUi?: BootstrapUiController
    bootstrapWindow?: BrowserWindowType
}

export type ApplicationStartupHandle = {
    deliverLaunchRequest(request: LaunchRequestEnvelopeV1): Promise<boolean>
    ready: Promise<void>
}

let applicationStarted = false

export async function startMainApplication(context: ApplicationStartupContext = {}): Promise<ApplicationStartupHandle> {
    if (applicationStarted) {
        throw new Error('Application main has already started')
    }
    applicationStarted = true
    setIsFirstInstance(true)
    if (context.bootstrapRuntime) {
        configureUpdaterBootstrapRuntime(context.bootstrapRuntime)
    }

    try {
        await enableSystemProxySupport()
        HandleErrorsElectron.processStoredCrashes()
        await initializeMusicPath()

        setUpdated(checkCLIArguments(isAppDev))
        await prestartCheck()
        if (isAppDev && (isWindows() || isMac())) {
            const openAtLogin = app.getLoginItemSettings().openAtLogin
            if (openAtLogin) {
                app.setLoginItemSettings({
                    openAtLogin: false,
                    path: app.getPath('exe'),
                })
            }
        }
        const startHidden = Boolean(State.get('settings.autoStartInTray'))
        const windowStartup = await createWindow({ bootstrapUi: context.bootstrapUi, bootstrapWindow: context.bootstrapWindow, startHidden })
        handleEvents(mainWindow)
        const handleLaunchRequest = await createApplicationLaunchRequestHandler()
        const legacyCompletedLaunchRequestIds = State.get('app.completedLaunchRequestIds')
        let persistedCompletedLaunchRequestIds: string[] = []
        try {
            persistedCompletedLaunchRequestIds = migrateCompletedLaunchRequestIds(legacyCompletedLaunchRequestIds)
            if (legacyCompletedLaunchRequestIds !== undefined) State.delete('app.completedLaunchRequestIds')
        } catch (error) {
            logger.main.warn('Failed to load completed launch requests:', error)
            persistedCompletedLaunchRequestIds = Array.isArray(legacyCompletedLaunchRequestIds)
                ? legacyCompletedLaunchRequestIds.filter((value: unknown): value is string => typeof value === 'string').slice(-256)
                : []
        }
        const completedIds = new Set<string>(persistedCompletedLaunchRequestIds)
        const deliverLaunchRequest = async (request: LaunchRequestEnvelopeV1): Promise<boolean> => {
            if (completedIds.has(request.id)) return true
            await windowStartup.ready
            await handleLaunchRequest(request)
            completedIds.add(request.id)
            try {
                const retainedIds = writeCompletedLaunchRequestIds(completedIds)
                completedIds.clear()
                retainedIds.forEach(id => completedIds.add(id))
            } catch (error) {
                logger.main.warn('Failed to persist completed launch request:', error)
            }
            return true
        }
        const pendingBrowserAuth = consumePendingBrowserAuthFromDeepLink()
        if (pendingBrowserAuth) {
            void processBrowserAuth(pendingBrowserAuth, { window: mainWindow }).catch(err => {
                logger.main.error('Failed to process pending BROWSER_AUTH deeplink:', err)
            })
        }
        const pendingInstallModUpdateFrom = consumePendingInstallModUpdateFromPath()
        if (pendingInstallModUpdateFrom) {
            runWhenUiReady(() => {
                void installModUpdateFromAsar(pendingInstallModUpdateFrom.path, mainWindow, pendingInstallModUpdateFrom.source).catch(err => {
                    logger.main.error('Failed to apply pending INSTALL_MOD_UPDATE_FROM:', err)
                })
            })
        }
        if (isWindows()) {
            await checkOldYandexMusic()
        }
        modManager(mainWindow)
        createTray()
        void sendAppStartupTelemetry()
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') app.quit()
        })
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) void createWindow()
        })
        return { ready: windowStartup.ready, deliverLaunchRequest }
    } catch (e) {
        HandleErrorsElectron.handleError('prestartCheck', 'checkYandexMusicApp', 'app_startup', e)
        logger.main.error(t('main.index.appStartupError'), e)
        applicationStarted = false
        throw e
    }
}

registerFileEvents()
registerAddonEvents()
