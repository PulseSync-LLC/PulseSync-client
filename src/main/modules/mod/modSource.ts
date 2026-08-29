import { STABLE_MOD_SOURCE } from '@common/types/modSource'

import { getState } from '../state'

import type { ModSourceSelection } from '@common/types/modSource'

const BRANCH_NAME_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,99}$/iu

export function normalizeModSourceSelection(value: unknown): ModSourceSelection | null {
    if (!value || typeof value !== 'object') return null

    const candidate = value as { branch?: unknown; type?: unknown }
    if (candidate.type === 'stable') return STABLE_MOD_SOURCE
    if (candidate.type !== 'branch' || typeof candidate.branch !== 'string') return null

    const branch = candidate.branch.trim()
    if (!BRANCH_NAME_PATTERN.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/')) return null

    return { branch, type: 'branch' }
}

export function getModSourceSelection(): ModSourceSelection {
    return normalizeModSourceSelection(getState().get('settings.modSource')) ?? STABLE_MOD_SOURCE
}

export function setModSourceSelection(value: unknown): ModSourceSelection {
    const selection = normalizeModSourceSelection(value)
    if (!selection) throw new Error('INVALID_MOD_SOURCE')

    getState().set('settings.modSource', selection)
    return selection
}
