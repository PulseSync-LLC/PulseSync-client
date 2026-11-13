import { BrowserWindow } from 'electron'

import * as fs from 'original-fs'
import path from 'path'

import { applyAddonSettingsValuesToConfig, collectAddonSettingsValuesFromConfig, HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import { normalizeCloudAddons, stableCloudJson as stableJson } from '@common/cloudSettings'
import RendererEvents from '@common/types/rendererEvents'

import { isCurrentAuthToken } from './auth/session'
import { sendAddonSettings } from './httpServer'
import { readAddonSettingsSchema, readAddonSettingsValuesFile } from './httpServer/addonSettings'
import { setAutoStartEnabled } from './startup/loginItem'
import { getState } from './state'
import { pickCloudPreferences } from './storage'
import { getAddonsRoot, resolveExistingDirectoryInsideBase, resolveExistingPathInsideBase } from './utils/addonPaths'
import { listAddonMetadata } from './utils/addonRegistry'

import type { CloudSettingsLocalState, CloudSettingsSession, CloudSettingsSnapshot } from '@common/cloudSettings'

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

const requireSession = (session: CloudSettingsSession) => {
    if (
        typeof session?.userId !== 'string' ||
        !session.userId ||
        session.userId === '-1' ||
        typeof session.token !== 'string' ||
        !session.token ||
        !isCurrentAuthToken(session.token)
    ) {
        throw new Error('CLOUD_SETTINGS_SESSION_CHANGED')
    }
}

const requireSnapshot = (snapshot: CloudSettingsSnapshot) => {
    if (!isRecord(snapshot?.settings) || !isRecord(snapshot?.addons) || !Object.values(snapshot.addons).every(isRecord)) {
        throw new Error('CLOUD_SETTINGS_INVALID_SNAPSHOT')
    }
}

const pendingUsers = (): string[] => {
    const stored: unknown = getState().get('app.cloudSettingsPendingDelete')
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
}

export const setCloudPendingDelete = (session: CloudSettingsSession, pending: boolean): void => {
    requireSession(session)
    if (typeof pending !== 'boolean') throw new Error('CLOUD_SETTINGS_INVALID_REQUEST')
    getState().set('app.cloudSettingsPendingDelete', [
        ...new Set([...pendingUsers().filter(id => id !== session.userId), ...(pending ? [session.userId] : [])]),
    ])
}

export const rememberCloudBaseline = (session: CloudSettingsSession, snapshot: CloudSettingsSnapshot | null): void => {
    requireSession(session)
    if (snapshot) requireSnapshot(snapshot)
    if (pendingUsers().includes(session.userId) && snapshot) return
    const previous = getState().get('app.cloudSettingsBaseline')
    if (snapshot) {
        const next = { userId: session.userId, snapshot }
        if (stableJson(previous) !== stableJson(next)) getState().set('app.cloudSettingsBaseline', next)
    } else if (previous?.userId === session.userId) {
        getState().delete('app.cloudSettingsBaseline')
    }
}

const addonDirectories = () =>
    listAddonMetadata().flatMap(addon => {
        if (addon.installSource !== 'store' || !addon.storeAddonId) return []
        const directory = resolveExistingDirectoryInsideBase(getAddonsRoot(), path.join(getAddonsRoot(), addon.directoryName))
        return addon.id && directory ? [{ ...addon, directory }] : []
    })

const captureSnapshot = (): CloudSettingsSnapshot => {
    const addons: CloudSettingsSnapshot['addons'] = {}
    for (const addon of addonDirectories()) {
        const schema = readAddonSettingsSchema(addon.directoryName)
        addons[addon.storeAddonId!] = {
            releaseChannel: addon.storeReleaseChannel ?? 'stable',
            settings: schema
                ? collectAddonSettingsValuesFromConfig(applyAddonSettingsValuesToConfig(schema, readAddonSettingsValuesFile(addon.directoryName)))
                : {},
        }
    }
    return { settings: pickCloudPreferences(getState().get('settings') ?? {}), addons }
}

export const applyCloudSnapshot = async (
    session: CloudSettingsSession,
    snapshot: CloudSettingsSnapshot,
    expected: CloudSettingsSnapshot,
): Promise<CloudSettingsSnapshot> => {
    requireSession(session)
    requireSnapshot(snapshot)
    requireSnapshot(expected)
    const { token: authToken, userId } = session
    if (!isCurrentAuthToken(authToken) || pendingUsers().includes(userId)) return expected
    const settings = pickCloudPreferences(snapshot.settings)
    const skippedSettings: string[] = []
    const skippedAddons: Record<string, string[]> = {}
    const previousAutoStart = getState().get('settings.autoStartApp')
    for (const [key, value] of Object.entries(settings)) {
        if (stableJson(getState().get(`settings.${key}`)) !== stableJson(expected.settings[key])) skippedSettings.push(key)
        else getState().set(`settings.${key}`, value)
    }
    const nextAutoStart = getState().get('settings.autoStartApp')
    if (nextAutoStart !== previousAutoStart) setAutoStartEnabled(nextAutoStart)
    for (const addon of addonDirectories()) {
        const values = snapshot.addons[addon.storeAddonId!]?.settings
        const schema = readAddonSettingsSchema(addon.directoryName)
        if (!isRecord(values) || !schema) continue
        const existing = readAddonSettingsValuesFile(addon.directoryName)
        const known = collectAddonSettingsValuesFromConfig(applyAddonSettingsValuesToConfig(schema, existing))
        const compatible = Object.fromEntries(
            Object.entries(values).filter(([key, value]) => {
                if (stableJson(known[key]) !== stableJson(expected.addons[addon.storeAddonId!]?.settings[key])) {
                    ;(skippedAddons[addon.storeAddonId!] ??= []).push(key)
                    return false
                }
                return Object.hasOwn(known, key) && ['string', 'number', 'boolean'].includes(typeof value) && typeof value === typeof known[key]
            }),
        )
        const next = { ...existing, ...compatible }
        if (stableJson(next) === stableJson(existing)) continue
        const target = path.join(addon.directory, HANDLE_EVENTS_SETTINGS_FILENAME)
        if (fs.existsSync(target) && !resolveExistingPathInsideBase(getAddonsRoot(), target)) continue
        if (!isCurrentAuthToken(authToken) || pendingUsers().includes(userId)) return expected
        await fs.promises.writeFile(target, JSON.stringify(next, null, 4), 'utf8')
        sendAddonSettings({ addonName: addon.directoryName, force: true })
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(RendererEvents.CLOUD_ADDON_SETTINGS_APPLIED, addon.id)
    }
    const nextBaseline = captureSnapshot()
    for (const key of skippedSettings) nextBaseline.settings[key] = expected.settings[key]
    for (const [id, keys] of Object.entries(skippedAddons)) {
        if (!nextBaseline.addons[id]) continue
        for (const key of keys) nextBaseline.addons[id].settings[key] = expected.addons[id]?.settings[key]
    }
    return nextBaseline
}

export const readCloudLocalState = (session: CloudSettingsSession, remote?: CloudSettingsSnapshot): CloudSettingsLocalState => {
    requireSession(session)
    if (remote) requireSnapshot(remote)
    const stored = getState().get('app.cloudSettingsBaseline')
    return {
        snapshot: captureSnapshot(),
        baseline:
            stored?.userId === session.userId && isRecord(stored.snapshot?.settings) && isRecord(stored.snapshot?.addons)
                ? { settings: stored.snapshot.settings, addons: normalizeCloudAddons(stored.snapshot.addons) }
                : null,
        pendingDelete: pendingUsers().includes(session.userId),
        remoteSnapshot: remote ? { settings: pickCloudPreferences(remote.settings), addons: normalizeCloudAddons(remote.addons) } : null,
    }
}

export const assertCloudAddonRestoreAllowed = (session: CloudSettingsSession): void => {
    requireSession(session)
    if (pendingUsers().includes(session.userId)) throw new Error('CLOUD_SETTINGS_DISABLED')
}
