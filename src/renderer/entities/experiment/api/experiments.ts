import rendererHttpClient from '@shared/api/http/client'
import type { ClientExperimentKey } from '@app/providers/experiments/constants'
import type { DesktopDetailedExperiment, DesktopDetailedExperimentGroup, DesktopExperiment, ExperimentMeta } from '@app/providers/experiments/types'

type RawExperimentEntry = {
    group?: unknown
    meta?: unknown
}

type RawDetailedExperimentGroup = {
    group?: unknown
    meta?: unknown
    description?: unknown
    rollout?: unknown
}

type RawDetailedExperimentEntry = {
    description?: unknown
    groups?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMeta(value: unknown): ExperimentMeta {
    return isRecord(value) ? { ...value } : {}
}

function normalizeGroup(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeRollout(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Number(value.toFixed(2)))) : 0
}

function normalizeActiveExperiments(payload: unknown): DesktopExperiment[] {
    if (!isRecord(payload)) {
        return []
    }

    return Object.entries(payload).flatMap(([key, value]) => {
        if (!isRecord(value)) {
            return []
        }

        const group = normalizeGroup((value as RawExperimentEntry).group)
        if (!group) {
            return []
        }

        return [
            {
                key: key as ClientExperimentKey,
                group,
                meta: normalizeMeta((value as RawExperimentEntry).meta),
            },
        ]
    })
}

function normalizeDetailedGroups(value: unknown): DesktopDetailedExperimentGroup[] {
    if (!Array.isArray(value)) {
        return []
    }

    return value.flatMap(groupValue => {
        if (!isRecord(groupValue)) {
            return []
        }

        const group = normalizeGroup((groupValue as RawDetailedExperimentGroup).group)
        if (!group) {
            return []
        }

        return [
            {
                group,
                meta: normalizeMeta((groupValue as RawDetailedExperimentGroup).meta),
                description: typeof groupValue.description === 'string' ? groupValue.description : '',
                rollout: normalizeRollout((groupValue as RawDetailedExperimentGroup).rollout),
            },
        ]
    })
}

function normalizeDetailedExperiments(payload: unknown): DesktopDetailedExperiment[] {
    if (!isRecord(payload)) {
        return []
    }

    return Object.entries(payload).flatMap(([key, value]) => {
        if (!isRecord(value)) {
            return []
        }

        const detailedEntry = value as RawDetailedExperimentEntry

        return [
            {
                key: key as ClientExperimentKey,
                description: typeof detailedEntry.description === 'string' ? detailedEntry.description : '',
                groups: normalizeDetailedGroups(detailedEntry.groups),
            },
        ]
    })
}

export async function fetchExperiments(): Promise<DesktopExperiment[]> {
    const response = await rendererHttpClient.get<unknown>('/experiments', {
        auth: true,
    })

    if (!response.ok) {
        return []
    }

    return normalizeActiveExperiments(response.data)
}

export async function fetchDetailedExperiments(): Promise<DesktopDetailedExperiment[]> {
    const response = await rendererHttpClient.get<unknown>('/experiments/detailed', {
        auth: true,
    })

    if (!response.ok) {
        throw new Error(`Failed to fetch detailed experiments (${response.status})`)
    }

    return normalizeDetailedExperiments(response.data)
}
