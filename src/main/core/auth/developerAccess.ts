import mainHttpClient from '../http/client'
import { currentAuthSessionId, getAuthToken, isCurrentAuthToken } from './session'

const ROLE_CACHE_MS = 30_000
let cachedRole: { sessionId: string; developer: boolean; expiresAt: number } | null = null
let pendingRole: { token: string; promise: Promise<boolean | null> } | null = null

export async function getDeveloperAccountStatus(): Promise<boolean | null> {
    const token = await getAuthToken().catch(() => '')
    const sessionId = currentAuthSessionId()
    if (cachedRole?.sessionId !== sessionId) cachedRole = null
    if (!sessionId) return false
    if (!token) return cachedRole?.developer ?? null
    if (cachedRole && cachedRole.expiresAt > Date.now()) return cachedRole.developer
    if (pendingRole?.token === token) return pendingRole.promise

    const promise = (async () => {
        let developer: boolean | null = null
        try {
            const response = await mainHttpClient.post<{
                data?: { getMe?: { perms?: string } | null }
                errors?: unknown[]
            }>('/graphql', {
                authToken: token,
                timeoutMs: 5000,
                body: { query: 'query ModIntegrityRole { getMe { perms } }' },
            })
            const perms = response.data?.data?.getMe?.perms
            if (response.ok && !response.data?.errors?.length && typeof perms === 'string') developer = perms === 'developer'
        } catch {
            developer = null
        }
        if (currentAuthSessionId() !== sessionId || !isCurrentAuthToken(token)) return null
        if (developer === null) return cachedRole?.sessionId === sessionId ? cachedRole.developer : null
        cachedRole = { sessionId, developer, expiresAt: Date.now() + ROLE_CACHE_MS }
        return developer
    })()

    pendingRole = { token, promise }
    try {
        return await promise
    } finally {
        if (pendingRole?.promise === promise) pendingRole = null
    }
}

export async function isDeveloperAccount(): Promise<boolean> {
    return (await getDeveloperAccountStatus()) === true
}
