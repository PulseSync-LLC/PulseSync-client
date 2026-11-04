import { mergeCloudSettings, stableCloudJson } from '@common/cloudSettings'
import { getCloudSettings, saveCloudSettings, setCloudSettingsEnabled } from '@entities/settings/api/cloudSettings'
import { desktopApi } from '@shared/desktop/desktopApi'

import type { CloudSettingsLocalState, CloudSettingsSession, CloudSettingsSnapshot, CloudSettingsStatus } from '@common/cloudSettings'

let queue: Promise<unknown> = Promise.resolve()
const pendingDisableUsers = new Set<string>()
const restoreAttempts = new Map<string, number>()
let restoreToken = ''

const restoreCloudAddons = async (session: CloudSettingsSession, remote: CloudSettingsSnapshot, local: CloudSettingsLocalState) => {
    if (restoreToken !== session.token) {
        restoreAttempts.clear()
        restoreToken = session.token
    }
    let changed = false
    let failed = false
    for (const [id, entry] of Object.entries(remote.addons)) {
        if (Object.hasOwn(local.snapshot.addons, id) || Object.hasOwn(local.baseline?.addons ?? {}, id)) continue
        if (pendingDisableUsers.has(session.userId)) break
        const current = await desktopApi.settings.readCloudLocalState(session)
        if (current.pendingDelete) break
        if (Object.hasOwn(current.snapshot.addons, id)) continue
        if (Date.now() - (restoreAttempts.get(id) ?? 0) < 60_000) {
            failed = true
            continue
        }
        restoreAttempts.set(id, Date.now())
        const result = (await desktopApi.addons.installStore({
            id,
            releaseChannel: entry.releaseChannel,
            openAfterInstall: false,
            cloudSession: session,
        })) as { success?: boolean }
        if (result?.success) changed = true
        else failed = true
    }
    return { changed, failed }
}

export const synchronizeCloudSettings = (
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

    const run = async (): Promise<CloudSettingsStatus> => {
        const session = await sessionPromise
        await markDeletion
        let local = await desktopApi.settings.readCloudLocalState(session)
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
            return { enabled: !pendingDelete, pendingDelete, addonsChanged: restoration.changed, addonRestoreFailed: restoration.failed }
        } else {
            await desktopApi.settings.rememberCloudBaseline(session, null)
        }
        const pendingDelete = pendingDisableUsers.has(userId)
        return { enabled: remote.enabled && !pendingDelete, pendingDelete }
    }

    const operation = queue.then(run)
    queue = operation.catch(() => {})
    return operation
}
