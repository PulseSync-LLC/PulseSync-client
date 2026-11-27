import { mergeCloudSettings, stableCloudJson } from './cloudSettings'

import type { CloudSettingsLocalState, CloudSettingsSession, CloudSettingsSnapshot, CloudSettingsState, CloudSettingsStatus } from './cloudSettings'
import type { PulseSyncDesktopApi } from './desktopApi/contract'

type SnapshotInput = CloudSettingsSnapshot & { revision: number }
type CloudSyncDependencies = {
    desktopApi: {
        auth: Pick<PulseSyncDesktopApi['auth'], 'getToken'>
        settings: Pick<
            PulseSyncDesktopApi['settings'],
            'readCloudLocalState' | 'setCloudPendingDelete' | 'rememberCloudBaseline' | 'applyCloudSnapshot'
        >
        addons: Pick<PulseSyncDesktopApi['addons'], 'installStore'>
    }
    getCloudSettings(token: string, userId: string): Promise<CloudSettingsState>
    saveCloudSettings(token: string, input: SnapshotInput): Promise<CloudSettingsState>
    setCloudSettingsEnabled(token: string, enabled: boolean, input?: SnapshotInput): Promise<CloudSettingsState>
}

export function createCloudSettingsSynchronizer({ desktopApi, getCloudSettings, saveCloudSettings, setCloudSettingsEnabled }: CloudSyncDependencies) {
    let queue: Promise<unknown> = Promise.resolve()
    const pendingDisableUsers = new Set<string>()
    const restoreAttempts = new Map<string, { checkedAt: number; releaseChannel: 'stable' | 'dev'; unavailable: boolean }>()
    let restoreToken = ''
    let lastSync: { userId: string; token: string; checkedAt: number; status?: CloudSettingsStatus } | undefined

    const LOCAL_CHANGE_INTERVAL = 15_000
    const RETRY_INTERVAL = 60_000
    const REMOTE_CHECK_INTERVAL = 5 * 60_000
    const DISABLED_CHECK_INTERVAL = 15 * 60_000

    const restoreCloudAddons = async (session: CloudSettingsSession, remote: CloudSettingsSnapshot, local: CloudSettingsLocalState) => {
        if (restoreToken !== session.token) {
            restoreAttempts.clear()
            restoreToken = session.token
        }
        let changed = false
        let failed = false
        let unavailable = false
        for (const [id, entry] of Object.entries(remote.addons)) {
            if (Object.hasOwn(local.snapshot.addons, id) || Object.hasOwn(local.baseline?.addons ?? {}, id)) continue
            if (pendingDisableUsers.has(session.userId)) break
            const current = await desktopApi.settings.readCloudLocalState(session)
            if (current.pendingDelete) break
            if (Object.hasOwn(current.snapshot.addons, id)) continue
            const previous = restoreAttempts.get(id)
            if (
                previous?.releaseChannel === entry.releaseChannel &&
                Date.now() - previous.checkedAt < (previous.unavailable ? REMOTE_CHECK_INTERVAL : RETRY_INTERVAL)
            ) {
                if (previous.unavailable) unavailable = true
                else failed = true
                continue
            }
            const attempt = { checkedAt: Date.now(), releaseChannel: entry.releaseChannel, unavailable: false }
            restoreAttempts.set(id, attempt)
            const result = (await desktopApi.addons.installStore({
                id,
                releaseChannel: entry.releaseChannel,
                openAfterInstall: false,
                cloudSession: session,
            })) as { success?: boolean; reason?: string }
            if (result?.success) changed = true
            else if (result?.reason === 'STORE_RELEASE_UNAVAILABLE') {
                attempt.unavailable = true
                unavailable = true
            } else failed = true
        }
        return { changed, failed, unavailable }
    }

    const synchronizeCloudSettings = (
        userId: string,
        enabled?: boolean,
        onStatus?: (status: CloudSettingsStatus) => void,
    ): Promise<CloudSettingsStatus> => {
        const sessionPromise = desktopApi.auth.getToken().then(token => ({ userId, token }))
        if (enabled === false) pendingDisableUsers.add(userId)
        const markDeletion =
            enabled === false ? sessionPromise.then(session => desktopApi.settings.setCloudPendingDelete(session, true)) : Promise.resolve()
        void markDeletion.catch(() => {})
        void sessionPromise.catch(() => {})
        let attempt: typeof lastSync

        const run = async (): Promise<CloudSettingsStatus> => {
            const session = await sessionPromise
            await markDeletion
            let local = await desktopApi.settings.readCloudLocalState(session)
            const previous = lastSync?.userId === userId && lastSync.token === session.token ? lastSync : undefined
            if (enabled === undefined && previous) {
                const status = previous.status
                const localChanged = status?.enabled && local.baseline && stableCloudJson(local.snapshot) !== stableCloudJson(local.baseline)
                const retrying = !status || status.offline || status.pendingDelete || status.addonRestoreFailed
                const interval = retrying
                    ? RETRY_INTERVAL
                    : localChanged
                      ? LOCAL_CHANGE_INTERVAL
                      : status.enabled
                        ? REMOTE_CHECK_INTERVAL
                        : DISABLED_CHECK_INTERVAL
                if (Date.now() - previous.checkedAt < interval) {
                    if (!status) throw new Error('CLOUD_SETTINGS_RETRY_DELAY')
                    const pendingDelete = local.pendingDelete || pendingDisableUsers.has(userId)
                    return { ...status, enabled: status.enabled && !pendingDelete, pendingDelete, addonsChanged: false }
                }
            }
            attempt = { ...session, checkedAt: Date.now(), status: previous?.status }
            lastSync = attempt
            let remote
            try {
                remote = await getCloudSettings(session.token, userId)
            } catch (error) {
                if (local.pendingDelete || pendingDisableUsers.has(userId)) return { enabled: false, pendingDelete: true }
                if (local.baseline) return { enabled: true, pendingDelete: false, offline: true }
                throw error
            }
            local = await desktopApi.settings.readCloudLocalState(session, remote)
            const deletionPending = local.pendingDelete || pendingDisableUsers.has(userId)
            onStatus?.({ enabled: remote.enabled && !deletionPending, pendingDelete: deletionPending })
            if (local.pendingDelete || pendingDisableUsers.has(userId)) {
                try {
                    await setCloudSettingsEnabled(session.token, false)
                    await desktopApi.settings.setCloudPendingDelete(session, false)
                    await desktopApi.settings.rememberCloudBaseline(session, null)
                    pendingDisableUsers.delete(userId)
                } catch {
                    return { enabled: false, pendingDelete: true }
                }
                return { enabled: false, pendingDelete: false }
            }
            if (enabled === true && !remote.enabled) {
                remote = await setCloudSettingsEnabled(session.token, true, { ...local.snapshot, revision: remote.revision })
                await desktopApi.settings.rememberCloudBaseline(session, local.snapshot)
            } else if (remote.enabled) {
                const remoteSnapshot = local.remoteSnapshot!
                const restoration = await restoreCloudAddons(session, remoteSnapshot, local)
                local = await desktopApi.settings.readCloudLocalState(session, remoteSnapshot)
                if (local.pendingDelete || pendingDisableUsers.has(userId))
                    return { enabled: false, pendingDelete: true, addonsChanged: restoration.changed }
                const merged = mergeCloudSettings(remoteSnapshot, local.snapshot, local.baseline ?? local.snapshot)
                if (stableCloudJson(merged) !== stableCloudJson({ settings: remote.settings, addons: remote.addons })) {
                    remote = await saveCloudSettings(session.token, { ...merged, revision: remote.revision })
                }
                const nextBaseline = await desktopApi.settings.applyCloudSnapshot(session, remote, local.snapshot)
                await desktopApi.settings.rememberCloudBaseline(session, nextBaseline)
                const pendingDelete = pendingDisableUsers.has(userId)
                return {
                    enabled: !pendingDelete,
                    pendingDelete,
                    addonsChanged: restoration.changed,
                    addonRestoreFailed: restoration.failed,
                    addonRestoreUnavailable: restoration.unavailable,
                }
            } else {
                await desktopApi.settings.rememberCloudBaseline(session, null)
            }
            const pendingDelete = pendingDisableUsers.has(userId)
            return { enabled: remote.enabled && !pendingDelete, pendingDelete }
        }

        const operation = queue.then(run).then(
            status => {
                if (attempt) {
                    attempt.checkedAt = Date.now()
                    attempt.status = status
                }
                return status
            },
            error => {
                if (attempt) {
                    attempt.checkedAt = Date.now()
                    if (attempt.status) attempt.status = { ...attempt.status, offline: true, addonsChanged: false }
                }
                throw error
            },
        )
        queue = operation.catch(() => {})
        return operation
    }
    return synchronizeCloudSettings
}
