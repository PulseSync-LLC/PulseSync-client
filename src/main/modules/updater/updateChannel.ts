import config, { branch as buildBranch } from '@common/appConfig'
import { getState } from '../state'

export const UPDATE_CHANNELS = ['beta', 'dev'] as const

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

const UPDATE_CHANNEL_OVERRIDE_KEY = 'app.updateChannelOverride'

export function normalizeUpdateChannel(value: unknown): UpdateChannel | null {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim().toLowerCase()
    return UPDATE_CHANNELS.includes(normalized as UpdateChannel) ? (normalized as UpdateChannel) : null
}

export function getBuildUpdateChannel(): UpdateChannel {
    return normalizeUpdateChannel(buildBranch) ?? 'beta'
}

export function getUpdateChannelOverride(): UpdateChannel | null {
    return normalizeUpdateChannel(getState().get(UPDATE_CHANNEL_OVERRIDE_KEY))
}

export function setUpdateChannelOverride(channel: unknown): UpdateChannel | null {
    const nextOverride = normalizeUpdateChannel(channel)
    getState().set(UPDATE_CHANNEL_OVERRIDE_KEY, nextOverride ?? '')
    return nextOverride
}

export function getEffectiveUpdateChannel(): UpdateChannel {
    return getUpdateChannelOverride() ?? getBuildUpdateChannel()
}

export function shouldAllowDowngradeForCurrentChannel(): boolean {
    const overrideChannel = getUpdateChannelOverride()
    return overrideChannel !== null && overrideChannel !== getBuildUpdateChannel()
}

export function getUpdateFeedUrl(channel: UpdateChannel): string {
    return `${config.S3_URL}/builds/app/${channel}/`
}

export function getMacManifestUrl(channel: UpdateChannel): string {
    return `${getUpdateFeedUrl(channel)}download.json`
}
