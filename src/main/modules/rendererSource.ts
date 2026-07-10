import { app } from 'electron'
import axios from 'axios'
import * as semver from 'semver'
import { DESKTOP_API_VERSION } from '@common/desktopApi/contract'
import { isDevmark } from '@common/appConfig'
import isAppDev from '../utils/isAppDev'
import logger from './logger'
import { getState } from './state'
import { getUrlOrigin, isAllowedRemoteRendererUrl, shouldAllowDevRemoteRenderer } from './security/remoteRendererPolicy'

export const DEFAULT_REMOTE_RENDERER_MANIFEST_URL = 'https://pulsesync.dev/app/desktop/manifest.json'

export interface RemoteRendererManifest {
    buildNumber: string
    url: string
    requiresDesktopApi: string
    minClientVersion?: string
}

export type MainRendererSource = {
    kind: 'remote'
    url: string
    origin: string
    manifest: RemoteRendererManifest
}

function rejectRemoteRenderer(message: string, details?: Record<string, unknown>): never {
    if (details) {
        logger.main.warn(message, details)
    } else {
        logger.main.warn(message)
    }
    throw new Error(message)
}

function getRemoteManifestUrl(): string {
    const envManifestUrl = process.env.PULSESYNC_REMOTE_RENDERER_MANIFEST_URL?.trim()
    if (envManifestUrl) {
        return envManifestUrl
    }

    const stored = String(getState().get('app.remoteRendererManifestUrl') || '').trim()
    return stored || DEFAULT_REMOTE_RENDERER_MANIFEST_URL
}

function isDesktopApiCompatible(requiredRange: string): boolean {
    const current = semver.valid(DESKTOP_API_VERSION)
    if (!current) return false
    return semver.satisfies(current, requiredRange, { includePrerelease: true })
}

function isClientVersionCompatible(minClientVersion: string | undefined): boolean {
    if (!minClientVersion) return true
    const current = semver.valid(app.getVersion())
    const minimum = semver.valid(minClientVersion)
    if (!current || !minimum) return false
    return semver.gte(current, minimum)
}

function parseManifest(value: unknown): RemoteRendererManifest | null {
    if (!value || typeof value !== 'object') return null
    const manifest = value as Partial<RemoteRendererManifest>
    if (typeof manifest.buildNumber !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(manifest.buildNumber)) return null
    if (typeof manifest.url !== 'string') return null
    if (typeof manifest.requiresDesktopApi !== 'string') return null
    if (manifest.minClientVersion !== undefined && typeof manifest.minClientVersion !== 'string') return null
    return {
        buildNumber: manifest.buildNumber,
        url: manifest.url,
        requiresDesktopApi: manifest.requiresDesktopApi,
        minClientVersion: manifest.minClientVersion,
    }
}

async function fetchRemoteManifest(manifestUrl: string): Promise<RemoteRendererManifest | null> {
    const response = await axios.get(manifestUrl, {
        timeout: 10000,
        responseType: 'json',
        validateStatus: status => status >= 200 && status < 300,
    })
    return parseManifest(response.data)
}

export async function resolveMainRendererSource(): Promise<MainRendererSource> {
    const manifestUrl = getRemoteManifestUrl()
    const allowDevRemoteRenderer = shouldAllowDevRemoteRenderer(isAppDev, isDevmark)
    if (!isAllowedRemoteRendererUrl(manifestUrl, allowDevRemoteRenderer)) {
        rejectRemoteRenderer('Remote renderer manifest URL is not allowlisted', { manifestUrl })
    }
    const manifestOrigin = getUrlOrigin(manifestUrl)
    if (!manifestOrigin) {
        rejectRemoteRenderer('Remote renderer manifest origin is invalid', { manifestUrl })
    }

    try {
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

        if (!isClientVersionCompatible(manifest.minClientVersion)) {
            rejectRemoteRenderer('Remote renderer requires newer client', {
                currentVersion: app.getVersion(),
                minClientVersion: manifest.minClientVersion,
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

        logger.main.info('Remote renderer selected', {
            buildNumber: manifest.buildNumber,
            url: manifest.url,
            requiredApi: manifest.requiresDesktopApi,
        })

        return {
            kind: 'remote',
            url: manifest.url,
            origin,
            manifest,
        }
    } catch (error) {
        logger.main.error('Failed to resolve remote renderer', error)
        throw error
    }
}
