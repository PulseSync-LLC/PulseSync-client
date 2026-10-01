import mainHttpClient from '../http/client'
import { getState } from '../state'

const State = getState()
const EXPERIMENT_KEY = 'ClientModIntegrityCheck'
const CACHE_MS = 30_000
let cachedExperiment: { token: string; enabled: boolean; expiresAt: number } | null = null
let pendingExperiment: { token: string; promise: Promise<boolean> } | null = null

export async function isModIntegrityCheckEnabled(): Promise<boolean> {
    const storedToken = State.get('tokens.token')
    const token = typeof storedToken === 'string' ? storedToken : ''
    if (cachedExperiment?.token === token && cachedExperiment.expiresAt > Date.now()) return cachedExperiment.enabled
    if (pendingExperiment?.token === token) return pendingExperiment.promise

    const promise = (async () => {
        let enabled = true
        try {
            const response = await mainHttpClient.get<unknown>('/experiments', {
                authToken: token,
                timeoutMs: 5000,
            })
            if (response.ok && response.data && typeof response.data === 'object' && !Array.isArray(response.data)) {
                const experiment = (response.data as Record<string, unknown>)[EXPERIMENT_KEY]
                if (experiment && typeof experiment === 'object' && !Array.isArray(experiment)) {
                    const group = (experiment as Record<string, unknown>).group
                    if (typeof group === 'string') {
                        const normalizedGroup = group.trim()
                        enabled = normalizedGroup === 'on' || normalizedGroup.startsWith('on_')
                    }
                }
            }
        } catch {
            enabled = true
        }
        const currentToken = State.get('tokens.token')
        if ((typeof currentToken === 'string' ? currentToken : '') !== token) return true
        cachedExperiment = { token, enabled, expiresAt: Date.now() + CACHE_MS }
        return enabled
    })()

    pendingExperiment = { token, promise }
    try {
        return await promise
    } finally {
        if (pendingExperiment?.promise === promise) pendingExperiment = null
    }
}
