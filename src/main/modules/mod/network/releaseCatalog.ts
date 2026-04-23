import { app } from 'electron'
import * as semver from 'semver'

import config from '@common/appConfig'
import { getState } from '../../state'
import { findGitHubAsset, listStableGitHubReleases, normalizeGitHubTagVersion } from '../../updater/githubReleaseResolver'
import type { UpdateSource } from '../../updater/updateSource'

export type ModReleaseEntry = {
    checksum: string
    checksum_v2: string
    changelog: string
    createdAt: string
    deprecated: boolean
    downloadUnpackedUrl: string
    downloadUrl: string
    id: number
    modVersion: string
    musicVersion: string
    name: string
    realMusicVersion: string
    shouldReinstall: boolean
    showModal: string
    source: UpdateSource
    spoof: boolean
    unpackedChecksum: string
}

const MOD_REPO = {
    owner: 'PulseSync-LLC',
    repo: 'PulseSync-mod',
}

const GET_MODS_QUERY = `
    query GetMod {
        getMod {
            id
            musicVersion
            realMusicVersion
            name
            modVersion
            downloadUrl
            downloadUnpackedUrl
            unpackedChecksum
            createdAt
            showModal
            shouldReinstall
            checksum
            checksum_v2
            spoof
            deprecated
        }
    }
`

const USER_AGENT = () =>
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PulseSync/${app.getVersion()} Chrome/142.0.7444.59 Electron/39.1.1 Safari/537.36`

function resolveTokenHeader(): Record<string, string> {
    const token = getState().get('tokens.token')
    return typeof token === 'string' && token ? { Authorization: `Bearer ${token}` } : {}
}

function sortModReleases(entries: ModReleaseEntry[]): ModReleaseEntry[] {
    return [...entries].sort((left, right) => {
        const leftVersion = semver.valid(left.modVersion)
        const rightVersion = semver.valid(right.modVersion)

        if (leftVersion && rightVersion) {
            return semver.rcompare(leftVersion, rightVersion)
        }

        return (right.createdAt || '').localeCompare(left.createdAt || '')
    })
}

export async function fetchBackendModReleases(): Promise<ModReleaseEntry[]> {
    const response = await fetch(`${config.SERVER_URL}/graphql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT(),
            ...resolveTokenHeader(),
        },
        body: JSON.stringify({
            query: GET_MODS_QUERY,
        }),
    })

    if (!response.ok) {
        throw new Error(`Failed to load mod versions: HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
        data?: { getMod?: Array<Omit<ModReleaseEntry, 'changelog' | 'source'> & { changelog?: string | null }> }
        errors?: Array<{ message?: string }>
    }

    if (payload.errors?.length) {
        throw new Error(
            payload.errors
                .map(error => error.message)
                .filter(Boolean)
                .join('; ') || 'Failed to load mod versions',
        )
    }

    const entries = Array.isArray(payload.data?.getMod)
        ? payload.data.getMod.map(entry => ({
              ...entry,
              changelog: entry.changelog ?? '',
              source: 'backend' as const,
          }))
        : []

    return sortModReleases(entries)
}

export async function fetchGithubModReleases(): Promise<ModReleaseEntry[]> {
    const [release] = await listStableGitHubReleases(MOD_REPO)

    if (!release) {
        return []
    }

    const asarAsset =
        findGitHubAsset(release, ['app.asar.zst', 'app.asar', 'app.asar.gz']) ??
        release.assets.find(asset => asset.name.toLowerCase().startsWith('app.asar')) ??
        null

    if (!asarAsset) {
        throw new Error(`No mod archive found in GitHub release ${release.tag_name}`)
    }

    const unpackedAsset = findGitHubAsset(release, ['app.asar.unpacked.zip'])

    return [
        {
            id: release.id,
            musicVersion: '',
            realMusicVersion: '',
            name: release.name?.trim() || 'PulseSync Mod',
            modVersion: normalizeGitHubTagVersion(release.tag_name),
            downloadUrl: asarAsset.browser_download_url,
            downloadUnpackedUrl: unpackedAsset?.browser_download_url ?? '',
            unpackedChecksum: '',
            createdAt: release.published_at ?? '',
            showModal: '',
            shouldReinstall: false,
            checksum: '',
            checksum_v2: '',
            spoof: false,
            deprecated: false,
            changelog: release.body ?? '',
            source: 'github',
        },
    ]
}

export async function getModReleasesForSource(source: UpdateSource): Promise<ModReleaseEntry[]> {
    if (source === 'github') {
        return fetchGithubModReleases()
    }

    return fetchBackendModReleases()
}

export async function getGithubModRelease(): Promise<ModReleaseEntry | null> {
    const releases = await fetchGithubModReleases()
    return releases[0] ?? null
}
