export const BOOTSTRAP_UI_PHASES = [
    'checking',
    'downloading-app',
    'downloading-modules',
    'preparing',
    'restarting',
    'launching',
    'blocked',
    'error',
] as const

export const BOOTSTRAP_STATUS_KEYS = [
    'checking-for-updates',
    'downloading-client',
    'downloading-modules',
    'planning-update',
    'preparing-update',
    'restarting-client',
    'launching-client',
    'update-blocked',
    'update-failed',
    'canonical-launch-required',
] as const

export const BOOTSTRAP_ACTIONS = ['retry', 'continue'] as const

export type BootstrapUiPhase = (typeof BOOTSTRAP_UI_PHASES)[number]
export type BootstrapStatusKey = (typeof BOOTSTRAP_STATUS_KEYS)[number]
export type BootstrapAction = (typeof BOOTSTRAP_ACTIONS)[number]

export type BootstrapUiProgress = { kind: 'indeterminate' } | { kind: 'bytes'; read: number; total: number }

export type BootstrapUiStateV1 = {
    schemaVersion: 1
    phase: BootstrapUiPhase
    statusKey: BootstrapStatusKey
    progress: BootstrapUiProgress
    actions: BootstrapAction[]
}

export type BootstrapWindowApi = {
    ready(): void
    retry(): Promise<boolean>
    continue(): Promise<boolean>
    onState(listener: (state: BootstrapUiStateV1) => void): () => void
}

export const BOOTSTRAP_WINDOW_CHANNELS = {
    ready: 'pulsesync:bootstrap:ready',
    retry: 'pulsesync:bootstrap:retry',
    continue: 'pulsesync:bootstrap:continue',
    state: 'pulsesync:bootstrap:state',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
    const actual = Object.keys(value).sort()
    const expected = [...keys].sort()
    return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isBootstrapUiStateV1(value: unknown): value is BootstrapUiStateV1 {
    if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'phase', 'statusKey', 'progress', 'actions'])) {
        return false
    }
    if (
        value.schemaVersion !== 1 ||
        !BOOTSTRAP_UI_PHASES.includes(value.phase as BootstrapUiPhase) ||
        !BOOTSTRAP_STATUS_KEYS.includes(value.statusKey as BootstrapStatusKey) ||
        !Array.isArray(value.actions) ||
        value.actions.some(action => !BOOTSTRAP_ACTIONS.includes(action as BootstrapAction)) ||
        new Set(value.actions).size !== value.actions.length
    ) {
        return false
    }
    if (!isRecord(value.progress) || typeof value.progress.kind !== 'string') {
        return false
    }
    if (value.progress.kind === 'indeterminate') {
        return hasExactKeys(value.progress, ['kind'])
    }
    return (
        value.progress.kind === 'bytes' &&
        hasExactKeys(value.progress, ['kind', 'read', 'total']) &&
        isFiniteNonNegativeNumber(value.progress.read) &&
        isFiniteNonNegativeNumber(value.progress.total) &&
        value.progress.total > 0 &&
        value.progress.read <= value.progress.total
    )
}
