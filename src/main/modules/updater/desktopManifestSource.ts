import config from '@common/appConfig'
import { getEffectiveUpdateChannel, getUpdateFeedUrl, type UpdateChannel } from './updateChannel'
import { getUpdateSource, type UpdateSource } from './updateSource'

export type DesktopUpdateManifestRequest = {
    channel: UpdateChannel
    dist: string
    manifestUrl?: string
    requestedSource: UpdateSource
    serverHealthUrl?: string
}

export type ResolveDesktopUpdateManifestOptions = {
    channel?: UpdateChannel
    dist?: string
    source?: UpdateSource
}

function getBackendManifestUrl(channel: UpdateChannel, dist: string): string {
    const asset = dist.startsWith('darwin-')
        ? `desktop-update-hybrid-${dist}.json`
        : `desktop-update-${dist}.json`
    return `${getUpdateFeedUrl(channel)}${asset}?_=${Date.now()}`
}

function getServerHealthUrl(): string {
    return `${config.SERVER_v2_URL.replace(/\/+$/u, '')}/api/v2/health`
}

function getCurrentDist(): string {
    return `${process.platform}-${process.arch}`
}

export function getDesktopUpdateManifestRequest(options: ResolveDesktopUpdateManifestOptions = {}): DesktopUpdateManifestRequest {
    const channel = options.channel ?? getEffectiveUpdateChannel()
    const dist = options.dist ?? getCurrentDist()
    const requestedSource = options.source ?? getUpdateSource()

    if (requestedSource === 'github') {
        return { channel, dist, requestedSource }
    }
    return {
        channel,
        dist,
        requestedSource,
        manifestUrl: getBackendManifestUrl(channel, dist),
        serverHealthUrl: getServerHealthUrl(),
    }
}
