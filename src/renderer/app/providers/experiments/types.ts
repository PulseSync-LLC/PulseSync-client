import type { ReactNode } from 'react'
import type { ClientExperimentKey } from '@app/providers/experiments/constants'

export type ExperimentMeta = Record<string, unknown>

export type DesktopExperiment = {
    key: ClientExperimentKey
    group: string
    meta: ExperimentMeta
}

export type DesktopDetailedExperimentGroup = {
    group: string
    meta: ExperimentMeta
    description: string
    rollout: number
}

export type DesktopDetailedExperiment = {
    key: ClientExperimentKey
    description: string
    groups: DesktopDetailedExperimentGroup[]
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
