import mainHttpClient from '../http/client'
import { getAuthToken, isCurrentAuthToken } from './session'

const ROLE_CACHE_MS = 30_000
let cachedRole: { token: string; developer: boolean; expiresAt: number } | null = null
let pendingRole: { token: string; promise: Promise<boolean> } | null = null

export async function isDeveloperAccount(): Promise<boolean> {
    const token = await getAuthToken().catch(() => '')
    if (typeof token !== 'string' || !token) return false
    if (cachedRole?.token === token && cachedRole.expiresAt > Date.now()) return cachedRole.developer
    if (pendingRole?.token === token) return pendingRole.promise

    const promise = (async () => {
        let developer = false
        try {
            const response = await mainHttpClient.post<{
                data?: { getMe?: { perms?: string } | null }
                errors?: unknown[]
            }>('/graphql', {
                authToken: token,
                timeoutMs: 5000,
                body: { query: 'query ModIntegrityRole { getMe { perms } }' },
            })
            developer = response.ok && !response.data?.errors?.length && response.data?.data?.getMe?.perms === 'developer'
        } catch {
            developer = false
        }
        if (!isCurrentAuthToken(token)) return false
        cachedRole = { token, developer, expiresAt: Date.now() + ROLE_CACHE_MS }
        return developer
    })()

    pendingRole = { token, promise }
    try {
        return await promise
    } finally {
        if (pendingRole?.promise === promise) pendingRole = null
    }
}
