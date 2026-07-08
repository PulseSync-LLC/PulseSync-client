import { getEffectiveUpdateChannel, getUpdateFeedUrl, type UpdateChannel } from './updateChannel'
import { getUpdateSource, type UpdateSource } from './updateSource'
import { resolveClientGitHubDesktopManifestUrl } from './githubReleaseResolver'
import config from '@common/appConfig'

export type DesktopUpdateManifestSource = {
    channel: UpdateChannel
    dist: string
    source: UpdateSource
    url: string
}

export type ResolveDesktopUpdateManifestOptions = {
    channel?: UpdateChannel
    dist?: string
    source?: UpdateSource
}

function getBackendManifestUrl(channel: UpdateChannel, dist: string): string {
    return `${getUpdateFeedUrl(channel)}desktop-update-${dist}.json`
}

function getServerHealthUrl(): string {
    return `${config.SERVER_v2_URL.replace(/\/+$/u, '')}/api/v2/health`
}

async function isServerHealthy(): Promise<boolean> {
    try {
        const response = await fetch(getServerHealthUrl(), {
            headers: {
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(3000),
        })
        return response.ok
    } catch {
        return false
    }
}

function getCurrentDist(): string {
    return `${process.platform}-${process.arch}`
}

export async function resolveDesktopUpdateManifestSource(
    options: ResolveDesktopUpdateManifestOptions = {},
): Promise<DesktopUpdateManifestSource> {
    const channel = options.channel ?? getEffectiveUpdateChannel()
    const dist = options.dist ?? getCurrentDist()
    const source = options.source ?? getUpdateSource()
    const resolvedSource = source === 'backend' && !(await isServerHealthy()) ? 'github' : source

    return {
        channel,
        dist,
        source: resolvedSource,
        url: resolvedSource === 'github' ? await resolveClientGitHubDesktopManifestUrl(channel, dist) : getBackendManifestUrl(channel, dist),
    }
}
