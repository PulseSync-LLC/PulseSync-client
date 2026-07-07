import { app } from 'electron'
import axios from 'axios'

import type { UpdateChannel } from './updateChannel'

export type GitHubRepo = {
    owner: string
    repo: string
}

export type GitHubReleaseAsset = {
    browser_download_url: string
    content_type?: string
    digest?: string
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

export const CLIENT_REPO: GitHubRepo = {
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
    return String(tagName || '')
        .trim()
        .replace(/^v(?=\d)/u, '')
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

export async function listStableGitHubReleases(repo: GitHubRepo, perPage = 50): Promise<GitHubRelease[]> {
    const releases = await listGitHubReleases(repo, perPage)
    return releases.filter(release => !release.draft && !release.prerelease)
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

export async function resolveClientGitHubDesktopManifestUrl(channel: UpdateChannel, dist: string): Promise<string> {
    const release = await resolveGitHubRelease(CLIENT_REPO, channel)
    const asset = findGitHubAsset(release, [`desktop-update-${dist}.json`])
    if (!asset) {
        throw new Error(`No desktop update manifest found in GitHub release ${release.tag_name} for ${dist}`)
    }

    return asset.browser_download_url
}
