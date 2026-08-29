import * as semver from 'semver'

import config from '@common/appConfig'

import logger from '../../logger'
import { getState } from '../../state'
import { findGitHubAsset, listGitHubReleases, listStableGitHubReleases, normalizeGitHubTagVersion } from '../../updater/githubReleaseResolver'
import { getPulseSyncUserAgent } from './userAgent'

import type { UpdateSource } from '../../updater/updateSource'
import type { ModBranchBuildSummary, ModReleaseChannel, ModSourceSelection } from '@common/types/modSource'

export type ModReleaseEntry = {
    checksum?: string | null
    branch: string
    channel: ModReleaseChannel
    checksum_v2: string
    changelog: string
    createdAt: string
    commit: string
    deprecated: boolean
    downloadUnpackedUrl: string
    downloadUrl: string
    id: number
    modVersion: string
    musicVersion: string
    name: string
    realMusicVersion: string
    shouldReinstall: boolean
    showModal: boolean
    source: UpdateSource
    spoof: boolean
    unpackedChecksum: string
}

const MOD_REPO = {
    owner: 'PulseSync-LLC',
    repo: 'PulseSync-mod',
}

const BRANCH_RELEASE_PREFIX = 'branch-'

type BranchBuildMetadata = {
    branch: string
    builtAt: string
    commit: string
    version: string
    yandexMusicVersion: string
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

function normalizeGitHubAssetDigest(digest?: string): string {
    const rawDigest = String(digest || '').trim()
    if (!rawDigest) {
        return ''
    }

    const [algorithm, value] = rawDigest.split(':', 2)
    if (!value) {
        return ''
    }

    return algorithm.toLowerCase() === 'sha256' ? value.trim().toLowerCase() : ''
}

function resolveTokenHeader(): Record<string, string> {
    const token = getState().get('tokens.token')
    return typeof token === 'string' && token ? { Authorization: `Bearer ${token}` } : {}
}

function isBranchBuildMetadata(value: unknown): value is BranchBuildMetadata {
    if (!value || typeof value !== 'object') return false

    const metadata = value as Partial<BranchBuildMetadata>
    return (
        typeof metadata.branch === 'string' &&
        metadata.branch.length > 0 &&
        typeof metadata.commit === 'string' &&
        /^[a-f0-9]{40}$/iu.test(metadata.commit) &&
        typeof metadata.version === 'string' &&
        metadata.version.length > 0 &&
        typeof metadata.yandexMusicVersion === 'string' &&
        metadata.yandexMusicVersion.length > 0 &&
        typeof metadata.builtAt === 'string' &&
        !Number.isNaN(Date.parse(metadata.builtAt))
    )
}

async function fetchBranchBuildMetadata(url: string): Promise<BranchBuildMetadata> {
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': getPulseSyncUserAgent(),
        },
        signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) throw new Error(`Failed to load branch build metadata: HTTP ${response.status}`)

    const metadata = (await response.json()) as unknown
    if (!isBranchBuildMetadata(metadata)) throw new Error('Invalid branch build metadata')

    return metadata
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
            'User-Agent': getPulseSyncUserAgent(),
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
              branch: '',
              channel: 'stable' as const,
              commit: '',
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
            branch: '',
            channel: 'stable',
            musicVersion: '',
            realMusicVersion: '',
            name: 'Eclipse',
            modVersion: normalizeGitHubTagVersion(release.tag_name),
            downloadUrl: asarAsset.browser_download_url,
            downloadUnpackedUrl: unpackedAsset?.browser_download_url ?? '',
            unpackedChecksum: normalizeGitHubAssetDigest(unpackedAsset?.digest),
            createdAt: release.published_at ?? '',
            commit: '',
            showModal: true,
            shouldReinstall: false,
            checksum_v2: normalizeGitHubAssetDigest(asarAsset.digest),
            spoof: false,
            deprecated: false,
            changelog: release.body ?? '',
            source: 'github',
        },
    ]
}

export async function fetchGithubBranchBuilds(): Promise<ModReleaseEntry[]> {
    const releases = await listGitHubReleases(MOD_REPO, 50)
    const branchReleases = releases.filter(release => !release.draft && release.prerelease && release.tag_name.startsWith(BRANCH_RELEASE_PREFIX))

    const entries = await Promise.all(
        branchReleases.map(async (release): Promise<ModReleaseEntry | null> => {
            const branch = release.tag_name.slice(BRANCH_RELEASE_PREFIX.length)
            const asarAsset = findGitHubAsset(release, ['app.asar.zst'])
            const metadataAsset = findGitHubAsset(release, ['build.json'])
            if (!branch || !asarAsset || !metadataAsset) return null

            try {
                const metadata = await fetchBranchBuildMetadata(metadataAsset.browser_download_url)
                if (metadata.branch !== branch) {
                    logger.modManager.warn(`Ignoring mismatched branch build ${release.tag_name}: ${metadata.branch}`)
                    return null
                }

                return {
                    id: release.id,
                    branch,
                    channel: 'branch' as const,
                    commit: metadata.commit,
                    musicVersion: metadata.yandexMusicVersion,
                    realMusicVersion: metadata.yandexMusicVersion,
                    name: release.name || branch,
                    modVersion: metadata.version,
                    downloadUrl: asarAsset.browser_download_url,
                    downloadUnpackedUrl: '',
                    unpackedChecksum: '',
                    createdAt: metadata.builtAt,
                    showModal: false,
                    shouldReinstall: false,
                    checksum_v2: normalizeGitHubAssetDigest(asarAsset.digest),
                    spoof: false,
                    deprecated: false,
                    changelog: release.body ?? '',
                    source: 'github' as const,
                }
            } catch (error) {
                logger.modManager.warn(`Ignoring invalid branch build ${release.tag_name}`, error)
                return null
            }
        }),
    )

    return entries.filter((entry): entry is ModReleaseEntry => entry !== null).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getModBranchBuildSummaries(): Promise<ModBranchBuildSummary[]> {
    const builds = await fetchGithubBranchBuilds()
    return builds.map(build => ({
        branch: build.branch,
        builtAt: build.createdAt,
        commit: build.commit,
        version: build.modVersion,
        yandexMusicVersion: build.musicVersion,
    }))
}

export async function getModReleaseForSelection(selection: ModSourceSelection, stableSource: UpdateSource): Promise<ModReleaseEntry | null> {
    if (selection.type === 'stable') {
        const releases = await getModReleasesForSource(stableSource)
        return releases[0] ?? null
    }

    const builds = await fetchGithubBranchBuilds()
    return builds.find(build => build.branch === selection.branch) ?? null
}

export async function getModReleasesForSource(source: UpdateSource): Promise<ModReleaseEntry[]> {
    if (source === 'github') {
        return fetchGithubModReleases()
    }

    try {
        return await fetchBackendModReleases()
    } catch (error) {
        logger.modManager.warn('Backend mod release lookup failed, trying GitHub fallback', error)
        return fetchGithubModReleases()
    }
}

export async function getGithubModRelease(): Promise<ModReleaseEntry | null> {
    const releases = await fetchGithubModReleases()
    return releases[0] ?? null
}
