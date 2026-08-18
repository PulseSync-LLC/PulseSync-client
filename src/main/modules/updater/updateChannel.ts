import config, { branch as buildBranch } from '@common/appConfig'

import { readBootstrapSettings, writeBootstrapSettings } from '../bootstrap/bootstrapSettings'

export const UPDATE_CHANNELS = ['beta', 'dev'] as const

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number]

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
    return normalizeUpdateChannel(readBootstrapSettings().updateChannelOverride)
}

export function setUpdateChannelOverride(channel: unknown, allowDevToBetaSwitch = false): UpdateChannel | null {
    const nextOverride = normalizeUpdateChannel(channel)
    const nextEffectiveChannel = nextOverride ?? getBuildUpdateChannel()

    if (!allowDevToBetaSwitch && getEffectiveUpdateChannel() === 'dev' && nextEffectiveChannel !== 'dev') {
        throw new Error('Switching from the dev update channel to beta is not allowed')
    }

    writeBootstrapSettings({ updateChannelOverride: nextOverride ?? '' })
    return nextOverride
}

export function getEffectiveUpdateChannel(): UpdateChannel {
    return getUpdateChannelOverride() ?? getBuildUpdateChannel()
}

export function getUpdateFeedUrl(channel: UpdateChannel): string {
    return `${config.S3_URL}/builds/app/${channel}/`
}
