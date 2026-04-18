import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchExperiments } from '@entities/experiment/api/experiments'
import type { ClientExperimentKey } from '@app/providers/experiments/constants'
import type {
    DesktopExperiment,
    ExperimentOverrideMap,
    ExperimentsContextValue,
    ExperimentsProviderProps,
} from '@app/providers/experiments/types'

const STORAGE_KEY = 'pulsesync.desktop.experimentOverrides.v2'

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

        return Object.fromEntries(
            Object.entries(parsed).flatMap(([key, value]) => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    return []
                }

                const rawOverride = value as Record<string, unknown>
                if (typeof rawOverride.group !== 'string' || !rawOverride.group.trim()) {
                    return []
                }

                const meta = rawOverride.meta
                return [
                    [
                        key,
                        {
                            key: key as ClientExperimentKey,
                            group: rawOverride.group.trim(),
                            meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {},
                        },
                    ],
                ]
            }),
        )
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

export function ExperimentsProvider({ children, userId }: ExperimentsProviderProps) {
    const [experiments, setExperiments] = useState<DesktopExperiment[]>([])
    const [loading, setLoading] = useState(true)
    const [localOverrides, setLocalOverrides] = useState<ExperimentOverrideMap>({})

    useEffect(() => {
        setLocalOverrides(readOverrides())
    }, [])

    useEffect(() => {
        let active = true

        setLoading(true)
        setExperiments([])

        void fetchExperiments()
            .then(nextExperiments => {
                if (!active) {
                    return
                }

                setExperiments(nextExperiments)
            })
            .catch(() => {
                if (!active) {
                    return
                }

                setExperiments([])
            })
            .finally(() => {
                if (active) {
                    setLoading(false)
                }
            })

        return () => {
            active = false
        }
    }, [userId])

    const experimentsMap = useMemo(() => new Map(experiments.map(experiment => [experiment.key, experiment])), [experiments])

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

            return experiment
        },
        [experimentsMap, localOverrides],
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

            return experiment.group === 'on' || experiment.group.startsWith('on_')
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
        [
            checkExperiment,
            clearLocalOverride,
            experiments,
            getEnabledFlags,
            getExperiment,
            isExperimentEnabled,
            loading,
            localOverrides,
            setLocalOverride,
        ],
    )

    return <ExperimentsContext.Provider value={value}>{children}</ExperimentsContext.Provider>
}

export function useExperiments() {
    return useContext(ExperimentsContext)
}

export { CLIENT_EXPERIMENTS, KNOWN_CLIENT_EXPERIMENT_KEYS, isKnownClientExperimentKey } from '@app/providers/experiments/constants'
export type { ClientExperimentKey, KnownClientExperimentKey } from '@app/providers/experiments/constants'
