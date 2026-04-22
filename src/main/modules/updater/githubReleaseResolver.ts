import { app } from 'electron'
import axios from 'axios'

import type { UpdateChannel } from './updateChannel'
import type { MacUpdateAsset, MacUpdateManifest } from './macOsUpdater'

export type GitHubRepo = {
    owner: string
    repo: string
}

export type GitHubReleaseAsset = {
    browser_download_url: string
    content_type?: string
    name: string
    size?: number
}

export type GitHubRelease = {
    assets: GitHubReleaseAsset[]
    body?: string | null
    draft: boolean
    id: number
    name?: string | null
    prerelease: boolean
    published_at?: string | null
    tag_name: string
}

const CLIENT_REPO: GitHubRepo = {
    owner: 'PulseSync-LLC',
    repo: 'PulseSync-client',
}

const GITHUB_API_BASE_URL = 'https://api.github.com'

function getGithubRequestHeaders(): Record<string, string> {
    return {
        Accept: 'application/vnd.github+json',
        'User-Agent': `PulseSync/${app.getVersion()}`,
    }
}

export function normalizeGitHubTagVersion(tagName: string): string {
    return String(tagName || '').trim().replace(/^v(?=\d)/u, '')
}

export async function listGitHubReleases(repo: GitHubRepo, perPage = 20): Promise<GitHubRelease[]> {
    const response = await axios.get<GitHubRelease[]>(`${GITHUB_API_BASE_URL}/repos/${repo.owner}/${repo.repo}/releases`, {
        headers: getGithubRequestHeaders(),
        params: {
            per_page: perPage,
        },
        timeout: 15000,
    })

    return Array.isArray(response.data) ? response.data : []
}

export function findGitHubReleaseForChannel(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease | null {
    const isDevChannel = channel === 'dev'
    return releases.find(release => !release.draft && release.prerelease === isDevChannel) ?? null
}

export async function resolveGitHubRelease(repo: GitHubRepo, channel: UpdateChannel): Promise<GitHubRelease> {
    const releases = await listGitHubReleases(repo)
    const release = findGitHubReleaseForChannel(releases, channel)

    if (!release) {
        throw new Error(`No GitHub release found for ${repo.owner}/${repo.repo} (${channel})`)
    }

    return release
}

export function findGitHubAsset(release: GitHubRelease, assetNames: string[]): GitHubReleaseAsset | null {
    const normalizedNames = assetNames.map(name => name.toLowerCase())
    return release.assets.find(asset => normalizedNames.includes(asset.name.toLowerCase())) ?? null
}

export function findMacAssets(release: GitHubRelease): GitHubReleaseAsset[] {
    return release.assets.filter(asset => asset.name.toLowerCase().endsWith('.dmg') || asset.name.toLowerCase().endsWith('.zip'))
}

type ResolvedMacUpdateAsset = MacUpdateAsset & {
    fileType: 'dmg' | 'zip'
}

function detectMacAssetArch(assetName: string): 'arm64' | 'x64' | null {
    const normalized = assetName.toLowerCase()
    if (normalized.includes('arm64')) {
        return 'arm64'
    }
    if (normalized.includes('x64')) {
        return 'x64'
    }
    return null
}

export async function resolveClientGitHubMacManifest(channel: UpdateChannel): Promise<MacUpdateManifest> {
    const release = await resolveGitHubRelease(CLIENT_REPO, channel)
    const assets = findMacAssets(release)

    if (!assets.length) {
        throw new Error(`No macOS assets found in GitHub release ${release.tag_name}`)
    }

    const manifestAssets = assets
        .map(asset => {
            const arch = detectMacAssetArch(asset.name)
            if (!arch) {
                return null
            }

            return {
                arch,
                fileType: asset.name.toLowerCase().endsWith('.zip') ? 'zip' : 'dmg',
                url: asset.browser_download_url,
            } satisfies ResolvedMacUpdateAsset
        })
        .filter((asset): asset is ResolvedMacUpdateAsset => asset !== null)

    if (!manifestAssets.length) {
        throw new Error(`No supported macOS assets found in GitHub release ${release.tag_name}`)
    }

    const [firstAsset] = manifestAssets
    const preferredAsset = manifestAssets.find(asset => asset.arch === 'x64') ?? firstAsset

    if (!preferredAsset) {
        throw new Error(`No supported macOS assets found in GitHub release ${release.tag_name}`)
    }

    return {
        version: normalizeGitHubTagVersion(release.tag_name),
        url: preferredAsset.url,
        fileType: preferredAsset.fileType,
        releaseNotes: release.body ?? '',
        updateUrgency: undefined,
        assets: manifestAssets,
    }
}
