import axios from 'axios'

import { DESKTOP_CORE_VERSION } from '@common/desktopRuntime/version'

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
        'User-Agent': `PulseSync/${DESKTOP_CORE_VERSION}`,
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

export function findGitHubAsset(release: GitHubRelease, assetNames: string[]): GitHubReleaseAsset | null {
    const normalizedNames = assetNames.map(name => name.toLowerCase())
    return release.assets.find(asset => normalizedNames.includes(asset.name.toLowerCase())) ?? null
}
