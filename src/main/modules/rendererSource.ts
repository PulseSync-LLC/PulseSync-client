import axios from 'axios'
import * as semver from 'semver'
import { DESKTOP_API_VERSION } from '@common/desktopApi/contract'
import { isDevmark } from '@common/appConfig'
import isAppDev from '../utils/isAppDev'
import logger from './logger'
import { readBootstrapSettings } from './bootstrap/bootstrapSettings'
import {
    BACKEND_REMOTE_RENDERER_BASE_URL,
    GITHUB_REMOTE_RENDERER_BASE_URL,
    getUrlOrigin,
    isAllowedRemoteRendererUrl,
    shouldAllowDevRemoteRenderer,
} from './security/remoteRendererPolicy'
import { getEffectiveUpdateChannel } from './updater/updateChannel'
import { getUpdateSource, type UpdateSource } from './updater/updateSource'

const LEGACY_BACKEND_REMOTE_RENDERER_MANIFEST_URL = `${BACKEND_REMOTE_RENDERER_BASE_URL}/desktop/manifest.json`
const LEGACY_GITHUB_REMOTE_RENDERER_MANIFEST_URL = `${GITHUB_REMOTE_RENDERER_BASE_URL}/desktop/manifest.json`

type PublicRendererChannel = 'dev' | 'beta'

export interface RemoteRendererManifest {
    buildNumber: string
    url: string
    requiresDesktopApi: string
}

export type MainRendererSource = {
    kind: 'remote'
    url: string
    origin: string
    manifest: RemoteRendererManifest
}

function getPublicRendererChannel(): PublicRendererChannel {
    return getEffectiveUpdateChannel() === 'beta' ? 'beta' : 'dev'
}

function getBackendRendererManifestUrl(channel: PublicRendererChannel): string {
    return `${BACKEND_REMOTE_RENDERER_BASE_URL}/${channel}/desktop/manifest.json`
}

function getGithubRendererManifestUrl(channel: PublicRendererChannel): string {
    return `${GITHUB_REMOTE_RENDERER_BASE_URL}/${channel}/desktop/manifest.json`
}

function rejectRemoteRenderer(message: string, details?: Record<string, unknown>): never {
    if (details) {
        logger.main.warn(message, details)
    } else {
        logger.main.warn(message)
    }
    throw new Error(message)
}

export function getDefaultRemoteRendererManifestUrl(updateSource: UpdateSource): string {
    const channel = getPublicRendererChannel()
    return updateSource === 'github' ? getGithubRendererManifestUrl(channel) : getBackendRendererManifestUrl(channel)
}

function getRemoteManifestUrls(): string[] {
    const envManifestUrl = process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL?.trim()
    if (envManifestUrl) {
        return [envManifestUrl]
    }

    const updateSource = getUpdateSource()
    const channel = getPublicRendererChannel()
    const backendManifestUrl = readBootstrapSettings().remoteRendererManifestUrl || getBackendRendererManifestUrl(channel)
    const githubManifestUrl = getGithubRendererManifestUrl(channel)
    const orderedManifestUrls = updateSource === 'github' ? [githubManifestUrl, backendManifestUrl] : [backendManifestUrl, githubManifestUrl]
    if (channel === 'beta') {
        orderedManifestUrls.push(LEGACY_BACKEND_REMOTE_RENDERER_MANIFEST_URL, LEGACY_GITHUB_REMOTE_RENDERER_MANIFEST_URL)
    }
    return Array.from(new Set(orderedManifestUrls))
}

function isDesktopApiCompatible(requiredRange: string): boolean {
    const current = semver.valid(DESKTOP_API_VERSION)
    if (!current) return false
    return semver.satisfies(current, requiredRange, { includePrerelease: true })
}

function parseManifest(value: unknown): RemoteRendererManifest | null {
    if (!value || typeof value !== 'object') return null
    const manifest = value as Partial<RemoteRendererManifest>
    if (typeof manifest.buildNumber !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(manifest.buildNumber)) return null
    if (typeof manifest.url !== 'string') return null
    if (typeof manifest.requiresDesktopApi !== 'string') return null
    return {
        buildNumber: manifest.buildNumber,
        url: manifest.url,
        requiresDesktopApi: manifest.requiresDesktopApi,
    }
}

async function fetchRemoteManifest(manifestUrl: string): Promise<RemoteRendererManifest | null> {
    const requestUrl = new URL(manifestUrl)
    requestUrl.searchParams.set('_', String(Date.now()))
    const response = await axios.get(requestUrl.toString(), {
        timeout: 10000,
        responseType: 'json',
        validateStatus: status => status >= 200 && status < 300,
    })
    return parseManifest(response.data)
}

async function resolveRendererSourceFromManifest(manifestUrl: string, allowDevRemoteRenderer: boolean): Promise<MainRendererSource> {
    if (!isAllowedRemoteRendererUrl(manifestUrl, allowDevRemoteRenderer)) {
        rejectRemoteRenderer('Remote renderer manifest URL is not allowlisted', { manifestUrl })
    }
    const manifestOrigin = getUrlOrigin(manifestUrl)
    if (!manifestOrigin) {
        rejectRemoteRenderer('Remote renderer manifest origin is invalid', { manifestUrl })
    }

    const manifest = await fetchRemoteManifest(manifestUrl)
    if (!manifest) {
        rejectRemoteRenderer('Remote renderer manifest is invalid', { manifestUrl })
    }

    if (!isAllowedRemoteRendererUrl(manifest.url, allowDevRemoteRenderer)) {
        rejectRemoteRenderer('Remote renderer URL is not allowlisted', { url: manifest.url })
    }

    if (!isDesktopApiCompatible(manifest.requiresDesktopApi)) {
        rejectRemoteRenderer('Remote renderer requires incompatible desktop API', {
            currentApi: DESKTOP_API_VERSION,
            requiredApi: manifest.requiresDesktopApi,
        })
    }

    const origin = getUrlOrigin(manifest.url)
    if (!origin) {
        rejectRemoteRenderer('Remote renderer origin is invalid', { url: manifest.url })
    }
    if (origin !== manifestOrigin) {
        rejectRemoteRenderer('Remote renderer URL origin must match manifest origin', {
            manifestOrigin,
            rendererOrigin: origin,
        })
    }

    return {
        kind: 'remote',
        url: manifest.url,
        origin,
        manifest,
    }
}

export async function* resolveMainRendererSources(): AsyncGenerator<MainRendererSource, void, void> {
    const manifestUrls = getRemoteManifestUrls()
    const allowDevRemoteRenderer = shouldAllowDevRemoteRenderer(isAppDev, isDevmark)
    let sourceResolved = false
    let lastError: unknown

    for (const [index, manifestUrl] of manifestUrls.entries()) {
        try {
            const source = await resolveRendererSourceFromManifest(manifestUrl, allowDevRemoteRenderer)
            sourceResolved = true
            yield source
        } catch (error) {
            lastError = error
            logger.main.warn('Remote renderer source unavailable', {
                fallbackAvailable: index < manifestUrls.length - 1,
                manifestUrl,
                message: error instanceof Error ? error.message : String(error),
            })
        }
    }

    if (sourceResolved) return

    logger.main.error('Failed to resolve all remote renderer sources', lastError)
    throw lastError instanceof Error ? lastError : new Error('Failed to resolve all remote renderer sources')
}

export async function resolveMainRendererSource(): Promise<MainRendererSource> {
    for await (const source of resolveMainRendererSources()) {
        logger.main.info('Remote renderer selected', {
            buildNumber: source.manifest.buildNumber,
            url: source.url,
            requiredApi: source.manifest.requiresDesktopApi,
        })
        return source
    }

    throw new Error('Failed to resolve all remote renderer sources')
}
