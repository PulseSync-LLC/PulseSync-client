import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import GET_EXPERIMENTS from '../../queries/getExperiments.query'
import type { ClientExperimentKey } from './constants'
import type {
    DesktopExperiment,
    ExperimentOverrideMap,
    ExperimentsContextValue,
    ExperimentsProviderProps,
    GetExperimentsData,
} from './types'

const STORAGE_KEY = 'pulsesync.desktop.experimentOverrides'
const ANONYMOUS_SUBJECT_KEY = 'pulsesync.desktop.experimentSubjectId'

const defaultExperimentsContextValue: ExperimentsContextValue = {
    experiments: [],
    loading: true,
    getExperiment: () => undefined,
    checkExperiment: (_key, _group, fallback = false) => fallback,
    isExperimentEnabled: (_key, fallback = false) => fallback,
    getEnabledFlags: () => [],
    localOverrides: {},
    setLocalOverride: () => void 0,
    clearLocalOverride: () => void 0,
}

const ExperimentsContext = createContext<ExperimentsContextValue>(defaultExperimentsContextValue)

function readOverrides(): ExperimentOverrideMap {
    if (typeof window === 'undefined') {
        return {}
    }

    try {
        const rawValue = window.localStorage.getItem(STORAGE_KEY)
        if (!rawValue) {
            return {}
        }

        const parsed = JSON.parse(rawValue)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {}
        }

        return parsed as ExperimentOverrideMap
    } catch {
        return {}
    }
}

function persistOverrides(nextValue: ExperimentOverrideMap) {
    if (typeof window === 'undefined') {
        return
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue))
    } catch {}
}

function getOrCreateAnonymousSubjectId(): string {
    if (typeof window === 'undefined') {
        return ''
    }

    const existingValue = window.localStorage.getItem(ANONYMOUS_SUBJECT_KEY)
    if (existingValue) {
        return existingValue
    }

    const generatedValue =
        typeof window.crypto?.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : `anon_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

    window.localStorage.setItem(ANONYMOUS_SUBJECT_KEY, generatedValue)
    return generatedValue
}

function getRolloutPercentage(experiment: DesktopExperiment): number | null {
    const percentageValue = experiment.rollout && typeof experiment.rollout.percentage === 'number' ? experiment.rollout.percentage : null
    if (percentageValue === null || !Number.isFinite(percentageValue)) {
        return null
    }

    return Math.min(100, Math.max(0, percentageValue))
}

function hashExperimentSubject(value: string): number {
    let hash = 2166136261

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }

    return hash >>> 0
}

export function ExperimentsProvider({ children, userId }: ExperimentsProviderProps) {
    const { data, loading } = useQuery<GetExperimentsData>(GET_EXPERIMENTS, {
        fetchPolicy: 'cache-first',
        nextFetchPolicy: 'cache-first',
        errorPolicy: 'ignore',
    })

    const [localOverrides, setLocalOverrides] = useState<ExperimentOverrideMap>({})
    const [anonymousSubjectId, setAnonymousSubjectId] = useState('')

    useEffect(() => {
        setLocalOverrides(readOverrides())
        setAnonymousSubjectId(getOrCreateAnonymousSubjectId())
    }, [])

    const experiments = data?.getExperiments ?? []
    const experimentsMap = useMemo(() => new Map(experiments.map(experiment => [experiment.key, experiment])), [experiments])
    const rolloutSubjectId = userId || anonymousSubjectId

    const isExperimentIncludedInRollout = useCallback(
        (experiment: DesktopExperiment) => {
            const percentage = getRolloutPercentage(experiment)
            if (percentage === null) {
                return true
            }

            if (percentage <= 0) {
                return false
            }

            if (percentage >= 100) {
                return true
            }

            if (!rolloutSubjectId) {
                return false
            }

            const bucket = hashExperimentSubject(`${experiment.key}:${rolloutSubjectId}`) % 10000
            return bucket < Math.round(percentage * 100)
        },
        [rolloutSubjectId],
    )

    const getExperiment = useCallback(
        (key: ClientExperimentKey) => {
            const overriddenExperiment = localOverrides[key]
            if (overriddenExperiment) {
                return overriddenExperiment
            }

            const experiment = experimentsMap.get(key)
            if (!experiment) {
                return undefined
            }

            return isExperimentIncludedInRollout(experiment) ? experiment : undefined
        },
        [experimentsMap, isExperimentIncludedInRollout, localOverrides],
    )

    const checkExperiment = useCallback(
        (key: ClientExperimentKey, group: string, fallback: boolean = false) => {
            const experiment = getExperiment(key)
            if (!experiment) {
                return fallback
            }

            return experiment.group === group
        },
        [getExperiment],
    )

    const isExperimentEnabled = useCallback(
        (key: ClientExperimentKey, fallback: boolean = false) => {
            const experiment = getExperiment(key)
            if (!experiment) {
                return fallback
            }

            const nestedEnabled = experiment.value && typeof experiment.value.enabled === 'boolean' ? experiment.value.enabled : undefined
            if (typeof nestedEnabled === 'boolean') {
                return nestedEnabled
            }

            if (typeof experiment.enabled === 'boolean') {
                return experiment.enabled
            }

            return experiment.group === 'on'
        },
        [getExperiment],
    )

    const getEnabledFlags = useCallback(() => {
        const keys = new Set([...experiments.map(experiment => experiment.key), ...Object.keys(localOverrides)])
        return Array.from(keys)
            .filter((key): key is ClientExperimentKey => isExperimentEnabled(key as ClientExperimentKey))
            .sort((a, b) => a.localeCompare(b))
    }, [experiments, isExperimentEnabled, localOverrides])

    const setLocalOverride = useCallback((experiment: DesktopExperiment) => {
        setLocalOverrides(prev => {
            const nextValue = {
                ...prev,
                [experiment.key]: experiment,
            }

            persistOverrides(nextValue)
            return nextValue
        })
    }, [])

    const clearLocalOverride = useCallback((key: ClientExperimentKey) => {
        setLocalOverrides(prev => {
            const nextValue = { ...prev }
            delete nextValue[key]
            persistOverrides(nextValue)
            return nextValue
        })
    }, [])

    const value = useMemo(
        () => ({
            experiments,
            loading,
            getExperiment,
            checkExperiment,
            isExperimentEnabled,
            getEnabledFlags,
            localOverrides,
            setLocalOverride,
            clearLocalOverride,
        }),
        [checkExperiment, clearLocalOverride, experiments, getEnabledFlags, getExperiment, isExperimentEnabled, loading, localOverrides, setLocalOverride],
    )

    return <ExperimentsContext.Provider value={value}>{children}</ExperimentsContext.Provider>
}

export function useExperiments() {
    return useContext(ExperimentsContext)
}

export { CLIENT_EXPERIMENTS, KNOWN_CLIENT_EXPERIMENT_KEYS, isKnownClientExperimentKey } from './constants'
export type { ClientExperimentKey, KnownClientExperimentKey } from './constants'
