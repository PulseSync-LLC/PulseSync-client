import { getState } from '../state'

export const UPDATE_SOURCES = ['backend', 'github'] as const

export type UpdateSource = (typeof UPDATE_SOURCES)[number]

const UPDATE_SOURCE_KEY = 'app.updateSource'

export function normalizeUpdateSource(value: unknown): UpdateSource | null {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim().toLowerCase()
    return UPDATE_SOURCES.includes(normalized as UpdateSource) ? (normalized as UpdateSource) : null
}

export function hasStoredAuthToken(): boolean {
    const token = getState().get('tokens.token')
    return typeof token === 'string' && token.trim().length > 0
}

export function isAutonomousMode(): boolean {
    return !hasStoredAuthToken()
}

function getStoredUpdateSource(): UpdateSource {
    return normalizeUpdateSource(getState().get(UPDATE_SOURCE_KEY)) ?? 'backend'
}

export function getUpdateSource(): UpdateSource {
    if (isAutonomousMode()) {
        return 'github'
    }

    return getStoredUpdateSource()
}

export function setUpdateSource(source: unknown): UpdateSource {
    if (isAutonomousMode()) {
        return 'github'
    }

    const nextSource = normalizeUpdateSource(source) ?? 'backend'
    getState().set(UPDATE_SOURCE_KEY, nextSource)
    return nextSource
}
