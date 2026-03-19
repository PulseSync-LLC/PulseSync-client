import type { ReactNode } from 'react'
import type { ClientExperimentKey } from './constants'

export type ExperimentValue = Record<string, unknown> | null

export type ExperimentRollout = {
    percentage: number
} | null

export type DesktopExperiment = {
    key: ClientExperimentKey
    group?: string | null
    description?: string | null
    enabled?: boolean | null
    value?: ExperimentValue
    rollout?: ExperimentRollout
}

export type ExperimentOverrideMap = Record<string, DesktopExperiment>

export type ExperimentsContextValue = {
    experiments: DesktopExperiment[]
    loading: boolean
    getExperiment: (key: ClientExperimentKey) => DesktopExperiment | undefined
    checkExperiment: (key: ClientExperimentKey, group: string, fallback?: boolean) => boolean
    isExperimentEnabled: (key: ClientExperimentKey, fallback?: boolean) => boolean
    getEnabledFlags: () => ClientExperimentKey[]
    localOverrides: ExperimentOverrideMap
    setLocalOverride: (experiment: DesktopExperiment) => void
    clearLocalOverride: (key: ClientExperimentKey) => void
}

export type ExperimentsProviderProps = {
    children: ReactNode
    userId?: string | null
}

export type GetExperimentsData = {
    getExperiments: DesktopExperiment[]
}
