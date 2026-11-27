import { app, ipcMain } from 'electron'

import { BACKGROUND_IPC } from '@common/background'

import { authSessionEvents, deleteAuthToken } from './auth/session'
import { notifyBackgroundEvent, showBackgroundNotification, translateRenderer } from './backgroundNotifications'
import { backgroundTasks } from './backgroundTasks'
import { get_current_track } from './httpServer'
import { listening } from './listening'
import { realtime } from './realtime'
import { isRendererSuspended, scheduleRendererSuspension } from './rendererMemory'
import { isAllowedRemoteRendererUrl } from './security/remoteRendererPolicy'
import { isUiReady } from './uiReady'

import type { BackgroundConfiguration, BackgroundEvent, BackgroundPreferences } from '@common/background'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'

let preferences: BackgroundPreferences | undefined
let owned = false

export const canSuspendRenderer = (): boolean => owned && preferences?.suspendAllowed === true

export function registerBackgroundEvents(window: BrowserWindow, options: { authorized(): boolean; clearAuthorization(): void }): void {
    const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => {
        if (
            window.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            !isAllowedRemoteRendererUrl(event.senderFrame.url, true)
        )
            throw new Error('BACKGROUND_UNTRUSTED_SENDER')
    }
    const publish = (event: BackgroundEvent) => {
        if (!window.isDestroyed() && isUiReady() && !isRendererSuspended()) window.webContents.send(BACKGROUND_IPC.changed, event)
    }
    realtime.onEvent = event => {
        if (event.type === 'gateway' && isRendererSuspended()) {
            if (event.frame.e === 'notification_created') notifyBackgroundEvent(event.frame.d)
            if (event.frame.e === 'deprecated_version')
                showBackgroundNotification(translateRenderer('common.attentionTitle'), translateRenderer('auth.deprecatedSoon'))
            if (event.frame.e === 'hardware_identity_warning')
                showBackgroundNotification(translateRenderer('common.attentionTitle'), translateRenderer('auth.hardwareIdentityWarning'))
        }
        if (event.type === 'gateway' && event.frame.e === 'addon_store_updated') void backgroundTasks.checkAddonUpdates()
        publish(event)
    }
    backgroundTasks.onNotice = publish
    const signedOut = () => {
        preferences = undefined
        owned = false
        realtime.stop()
        backgroundTasks.setUser('')
        listening.stop()
        options.clearAuthorization()
    }
    realtime.onLogout = () => {
        void deleteAuthToken().catch(() => {})
    }
    authSessionEvents.on('cleared', signedOut)
    authSessionEvents.on('changed', signedOut)
    app.once('before-quit', signedOut)

    ipcMain.handle(BACKGROUND_IPC.start, async (event, value: BackgroundConfiguration) => {
        trusted(event)
        if (
            !options.authorized() ||
            !value ||
            typeof value.userId !== 'string' ||
            value.userId === '-1' ||
            value.userId.length > 128 ||
            typeof value.version !== 'string' ||
            value.version.length > 128 ||
            typeof value.page !== 'string' ||
            value.page.length > 2048 ||
            !value.buildIdentity ||
            typeof value.buildIdentity !== 'object'
        )
            throw new Error('BACKGROUND_INVALID_CONFIGURATION')
        const result = await realtime.start(value)
        if (result.userId === value.userId) {
            owned = true
            backgroundTasks.setUser(value.userId)
            if (preferences?.userId === value.userId) {
                realtime.setPreferences(preferences)
                backgroundTasks.start()
            }
            get_current_track()
            scheduleRendererSuspension()
        }
        return result
    })
    ipcMain.handle(BACKGROUND_IPC.preferences, (event, value: BackgroundPreferences) => {
        trusted(event)
        if (
            !value ||
            typeof value.userId !== 'string' ||
            value.userId.length > 128 ||
            ['trackSendingEnabled', 'metricsSendingEnabled', 'listeningEnabled', 'legacyAddonRestrictionsEnabled', 'suspendAllowed'].some(
                key => typeof value[key as keyof BackgroundPreferences] !== 'boolean',
            ) ||
            (value.legacyAddonRestrictionsOverrideGroup !== undefined &&
                (typeof value.legacyAddonRestrictionsOverrideGroup !== 'string' || value.legacyAddonRestrictionsOverrideGroup.length > 128))
        )
            throw new Error('BACKGROUND_INVALID_PREFERENCES')
        if (realtime.userId && value.userId !== realtime.userId) return
        owned = value.userId === '-1' || realtime.userId === value.userId
        const previous = preferences
        preferences = value
        realtime.setPreferences(value)
        if (value.listeningEnabled && !previous?.listeningEnabled) void listening.start().catch(() => {})
        else if (!value.listeningEnabled && previous?.listeningEnabled) listening.stop()
        backgroundTasks.start()
        scheduleRendererSuspension()
    })
    ipcMain.on(BACKGROUND_IPC.send, (event, name: unknown, payload: unknown) => {
        trusted(event)
        if (!options.authorized() || name !== 'user_settings_update') return
        realtime.send(name, payload)
    })
    ipcMain.handle(BACKGROUND_IPC.syncCloud, (event, userId: unknown, enabled: unknown) => {
        trusted(event)
        if (!options.authorized() || typeof userId !== 'string' || !userId || (enabled !== undefined && typeof enabled !== 'boolean'))
            throw new Error('CLOUD_SETTINGS_SESSION_CHANGED')
        return backgroundTasks.synchronizeCloud(userId, enabled as boolean | undefined)
    })
    ipcMain.handle(BACKGROUND_IPC.checkAddons, event => {
        trusted(event)
        if (!options.authorized()) return
        return backgroundTasks.checkAddonUpdates()
    })
}
