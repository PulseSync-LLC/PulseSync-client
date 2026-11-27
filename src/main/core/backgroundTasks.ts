import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { branch } from '@common/appConfig'
import { GET_CLOUD_SETTINGS, SAVE_CLOUD_SETTINGS, SET_CLOUD_SETTINGS_ENABLED } from '@common/cloudSettingsQueries'
import { createCloudSettingsSynchronizer } from '@common/cloudSettingsSync'
import { compareVersions } from '@common/compareVersions'

import logger from '../shared/logger'
import { getAuthToken, isCurrentAuthToken } from './auth/session'
import { showBackgroundNotification, translateRenderer } from './backgroundNotifications'
import { applyCloudSnapshot, readCloudLocalState, rememberCloudBaseline, setCloudPendingDelete } from './cloudSettings'
import { installStoreAddon } from './events/addonPackageEvents'
import mainHttpClient from './http/client'
import { realtime } from './realtime'
import { getState } from './state'
import { getAddonsRoot } from './utils/addonPaths'
import { listAddonMetadata } from './utils/addonRegistry'
import { classifyAddonRuntime } from './utils/addonRuntime'
import { isYandexMusicRunning } from './utils/appUtils'

import type { BackgroundEvent } from '@common/background'
import type { CloudSettingsState } from '@common/cloudSettings'
import type { DesktopInstallStoreAddonRequest } from '@common/desktopApi/contract'

type StoreUpdate = {
    id: string
    name: string
    type: string
    currentRelease?: { version: string; downloadUrl?: string; status?: string }
}

async function graphql<T>(token: string, query: string, variables?: object): Promise<T> {
    const response = await mainHttpClient.post<{ data?: T; errors?: unknown[] }>('/graphql', {
        authToken: token,
        body: { query, variables },
        headers: { 'x-pulsesync-channel': branch === 'dev' ? 'dev' : 'beta' },
        timeoutMs: 15_000,
    })
    if (!response.ok || response.data.errors?.length || !response.data.data || !isCurrentAuthToken(token))
        throw new Error('CLOUD_SETTINGS_REQUEST_FAILED')
    return response.data.data
}

class BackgroundTasks {
    private userId = ''
    private timer?: NodeJS.Timeout
    private syncing = false
    private checkingAddons?: Promise<void>
    private addonCheckAt = 0
    onNotice: (event: BackgroundEvent) => void = () => {}

    private install = async (request: DesktopInstallStoreAddonRequest) => {
        const userId = this.userId
        const result = await installStoreAddon(
            { ...request, openAfterInstall: false },
            { isAuthorized: () => !!userId && this.userId === userId, queueAddonOpen: () => {} },
        )
        if (result.success && this.userId === userId) this.onNotice({ type: 'addons-changed' })
        return result
    }

    synchronizeCloud = createCloudSettingsSynchronizer({
        desktopApi: {
            auth: { getToken: getAuthToken },
            settings: {
                readCloudLocalState: async (session, remote) => readCloudLocalState(session, remote),
                setCloudPendingDelete: async (session, pending) => {
                    setCloudPendingDelete(session, pending)
                },
                rememberCloudBaseline: async (session, snapshot) => {
                    rememberCloudBaseline(session, snapshot)
                },
                applyCloudSnapshot,
            },
            addons: { installStore: this.install },
        },
        getCloudSettings: async (token, userId) => {
            const data = await graphql<{ getMeWeb: { id: string } | null; getCloudSettings: CloudSettingsState }>(token, GET_CLOUD_SETTINGS)
            if (data.getMeWeb?.id !== userId || !data.getCloudSettings) throw new Error('CLOUD_SETTINGS_SESSION_CHANGED')
            return data.getCloudSettings
        },
        saveCloudSettings: async (token, input) => {
            const data = await graphql<{ saveCloudSettings: CloudSettingsState }>(token, SAVE_CLOUD_SETTINGS, { input })
            if (!data.saveCloudSettings) throw new Error('CLOUD_SETTINGS_EMPTY_RESPONSE')
            return data.saveCloudSettings
        },
        setCloudSettingsEnabled: async (token, enabled, input) => {
            const data = await graphql<{ setCloudSettingsEnabled: CloudSettingsState }>(token, SET_CLOUD_SETTINGS_ENABLED, { enabled, input })
            if (!data.setCloudSettingsEnabled) throw new Error('CLOUD_SETTINGS_EMPTY_RESPONSE')
            return data.setCloudSettingsEnabled
        },
    })

    setUser(userId: string): void {
        if (this.userId !== userId) this.addonCheckAt = 0
        this.userId = userId
        if (!userId) {
            clearInterval(this.timer)
            this.timer = undefined
        }
    }

    start(): void {
        if (this.timer || !this.userId) return
        this.timer = setInterval(() => void this.tick(), 15_000)
        this.timer.unref()
        void this.tick()
    }

    private async tick(): Promise<void> {
        const userId = this.userId
        if (!userId || this.syncing) return
        this.syncing = true
        try {
            await this.synchronizeCloud(userId).catch(() => {})
            if (this.userId !== userId) return
            if (Date.now() - this.addonCheckAt >= 10 * 60_000) await this.checkAddonUpdates()
            realtime.sendMetrics()
        } finally {
            this.syncing = false
        }
    }

    checkAddonUpdates(): Promise<void> {
        if (this.checkingAddons) return this.checkingAddons
        const operation = this.checkUpdates()
            .catch(error => {
                logger.main.warn('Could not check store addon updates in the background:', { name: (error as Error)?.name })
            })
            .finally(() => {
                if (this.checkingAddons === operation) this.checkingAddons = undefined
            })
        this.checkingAddons = operation
        return operation
    }

    private async checkUpdates(): Promise<void> {
        const userId = this.userId
        const preferences = realtime.preferences
        if (!userId || !preferences) return
        this.addonCheckAt = Date.now()
        const token = await getAuthToken()
        const installed = listAddonMetadata().filter(addon => addon.installSource === 'store' && addon.storeAddonId)
        const installedById = new Map(installed.map(addon => [addon.storeAddonId, addon]))
        if (!installed.length || !token || this.userId !== userId) return
        const updates: StoreUpdate[] = []
        for (const channel of ['stable', 'dev'] as const) {
            const ids = [...new Set(installed.filter(addon => addon.storeReleaseChannel === channel).map(addon => addon.storeAddonId!))]
            if (!ids.length) continue
            const response = await mainHttpClient.post<{ ok?: boolean; addons?: StoreUpdate[] }>('/extensions/updates', {
                authToken: token,
                headers: { 'x-pulsesync-channel': branch === 'dev' ? 'dev' : 'beta' },
                body: { ids, releaseChannel: channel },
                timeoutMs: 15_000,
            })
            if (!response.ok || response.data.ok === false || !Array.isArray(response.data.addons)) throw new Error('STORE_LOOKUP_FAILED')
            updates.push(...response.data.addons)
        }
        if (this.userId !== userId || !isCurrentAuthToken(token)) return
        const state = getState()
        const autoUpdate = state.get('settings.autoUpdateStoreAddons') !== false
        const musicRunning = !autoUpdate || (await isYandexMusicRunning())
        for (const addon of updates) {
            const local = installedById.get(addon.id)
            const release = addon.currentRelease
            if (!local || !release?.downloadUrl || !local.version || compareVersions(release.version, local.version) <= 0) continue
            if (this.userId !== userId || !isCurrentAuthToken(token)) return
            const notified = state.get('app.notifiedStoreAddonVersions') ?? {}
            if (!musicRunning && autoUpdate) {
                const result = await this.install({
                    id: addon.id,
                    releaseChannel: local.storeReleaseChannel,
                    title: addon.name,
                    legacyAddonRestrictionsOverrideGroup: preferences.legacyAddonRestrictionsOverrideGroup,
                })
                if (!result.success) continue
                const title = translateRenderer('common.doneTitle')
                const body = translateRenderer('extensions.storeUpdateComplete', { name: addon.name })
                showBackgroundNotification(title, body)
                this.onNotice({ type: 'notice', tone: 'success', title, body })
            } else {
                if (preferences.legacyAddonRestrictionsEnabled && addon.type === 'script') {
                    const directory = path.join(getAddonsRoot(), local.directoryName)
                    const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'))
                    if ((await classifyAddonRuntime(directory, metadata)) === 'legacy') continue
                }
                if (notified[addon.id] === release.version) continue
                const title = translateRenderer('extensions.storeUpdateAvailableTitle')
                const body = translateRenderer('extensions.storeUpdateAvailableMessage', { name: addon.name, version: release.version })
                showBackgroundNotification(title, body)
                this.onNotice({ type: 'notice', tone: 'info', title, body })
            }
            state.set('app.notifiedStoreAddonVersions', { ...notified, [addon.id]: release.version })
        }
    }
}

export const backgroundTasks = new BackgroundTasks()
