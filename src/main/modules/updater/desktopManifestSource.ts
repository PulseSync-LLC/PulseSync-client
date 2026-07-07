import { getEffectiveUpdateChannel, getUpdateFeedUrl, type UpdateChannel } from './updateChannel'
import { getUpdateSource, type UpdateSource } from './updateSource'
import { resolveClientGitHubDesktopManifestUrl } from './githubReleaseResolver'

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

function getCurrentDist(): string {
    return `${process.platform}-${process.arch}`
}

export async function resolveDesktopUpdateManifestSource(
    options: ResolveDesktopUpdateManifestOptions = {},
): Promise<DesktopUpdateManifestSource> {
    const channel = options.channel ?? getEffectiveUpdateChannel()
    const dist = options.dist ?? getCurrentDist()
    const source = options.source ?? getUpdateSource()

    return {
        channel,
        dist,
        source,
        url: source === 'github' ? await resolveClientGitHubDesktopManifestUrl(channel, dist) : getBackendManifestUrl(channel, dist),
    }
}
