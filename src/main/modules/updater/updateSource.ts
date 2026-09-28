import { readBootstrapSettings, writeBootstrapSettings } from '../bootstrap/bootstrapSettings'

export const UPDATE_SOURCES = ['backend', 'github'] as const

export type UpdateSource = (typeof UPDATE_SOURCES)[number]

export function normalizeUpdateSource(value: unknown): UpdateSource | null {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim().toLowerCase()
    return UPDATE_SOURCES.includes(normalized as UpdateSource) ? (normalized as UpdateSource) : null
}

function getStoredUpdateSource(): UpdateSource {
    return normalizeUpdateSource(readBootstrapSettings().updateSource) ?? 'backend'
}

export function getUpdateSource(): UpdateSource {
    return getStoredUpdateSource()
}

export function setUpdateSource(source: unknown): UpdateSource {
    const nextSource = normalizeUpdateSource(source) ?? 'backend'
    writeBootstrapSettings({ updateSource: nextSource })
    return nextSource
}
