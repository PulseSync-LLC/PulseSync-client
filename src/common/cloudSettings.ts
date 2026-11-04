export interface CloudAddonSettings {
    releaseChannel: 'stable' | 'dev'
    settings: Record<string, unknown>
}

export interface CloudSettingsSnapshot {
    settings: Record<string, unknown>
    addons: Record<string, CloudAddonSettings>
}

export interface CloudSettingsState extends CloudSettingsSnapshot {
    version: 1
    enabled: boolean
    revision: number
}

export interface CloudSettingsStatus {
    enabled: boolean
    pendingDelete: boolean
    offline?: boolean
    addonsChanged?: boolean
    addonRestoreFailed?: boolean
}

export interface CloudSettingsSession {
    userId: string
    token: string
}

export interface CloudSettingsLocalState {
    snapshot: CloudSettingsSnapshot
    baseline: CloudSettingsSnapshot | null
    pendingDelete: boolean
    remoteSnapshot: CloudSettingsSnapshot | null
}

export const stableCloudJson = (value: unknown): string =>
    JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
            : item,
    )

export const normalizeCloudAddons = (input: Record<string, unknown>): CloudSettingsSnapshot['addons'] =>
    Object.fromEntries(
        Object.entries(input)
            .filter((entry): entry is [string, CloudAddonSettings] => {
                const value = entry[1] as Partial<CloudAddonSettings> | null
                return (
                    /^[a-zA-Z0-9_-]{1,128}$/.test(entry[0]) &&
                    !!value &&
                    typeof value === 'object' &&
                    (value.releaseChannel === 'stable' || value.releaseChannel === 'dev') &&
                    !!value.settings &&
                    typeof value.settings === 'object' &&
                    !Array.isArray(value.settings)
                )
            })
            .map(([id, value]) => [id, { releaseChannel: value.releaseChannel, settings: value.settings }]),
    )

export const mergeCloudSettings = (
    remote: CloudSettingsSnapshot,
    local: CloudSettingsSnapshot,
    previous: CloudSettingsSnapshot,
): CloudSettingsSnapshot => {
    const settings = { ...local.settings, ...remote.settings }
    for (const [key, value] of Object.entries(local.settings)) {
        if (stableCloudJson(value) !== stableCloudJson(previous.settings[key])) settings[key] = value
    }
    const addons = { ...remote.addons }
    for (const id of Object.keys(previous.addons)) {
        if (!Object.hasOwn(local.addons, id)) delete addons[id]
    }
    for (const [id, entry] of Object.entries(local.addons)) {
        if (!Object.hasOwn(remote.addons, id)) {
            if (!Object.hasOwn(previous.addons, id) || stableCloudJson(entry) !== stableCloudJson(previous.addons[id])) addons[id] = entry
            continue
        }
        if (!Object.hasOwn(previous.addons, id)) {
            addons[id] = { ...remote.addons[id], settings: { ...entry.settings, ...remote.addons[id].settings } }
            continue
        }
        const changed = Object.fromEntries(
            Object.entries(entry.settings).filter(
                ([key, value]) =>
                    !Object.hasOwn(remote.addons[id].settings, key) || stableCloudJson(value) !== stableCloudJson(previous.addons[id]?.settings[key]),
            ),
        )
        addons[id] = {
            releaseChannel: entry.releaseChannel !== previous.addons[id].releaseChannel ? entry.releaseChannel : remote.addons[id].releaseChannel,
            settings: { ...remote.addons[id].settings, ...changed },
        }
    }
    return { settings, addons }
}
