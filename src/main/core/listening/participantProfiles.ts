import config from '@common/appConfig'
import { record } from '@common/listening/validation'

import { currentAuthSessionId, getAuthToken, isCurrentAuthToken } from '../auth/session'
import mainHttpClient from '../http/client'

interface Profile {
    name: string
    avatarUrl: string | null
}

let cached: { key: string; until: number; promise: Promise<Map<string, Profile>> } | undefined

export function participantProfiles(userIds: string[]): Promise<Map<string, Profile>> {
    const session = currentAuthSessionId()
    const ids = [...new Set(userIds)].sort().slice(0, 10)
    if (!session || !ids.length) return Promise.resolve(new Map())
    const key = JSON.stringify([session, ids])
    if (cached?.key === key && cached.until > performance.now()) return cached.promise
    const entry = { key, until: performance.now() + 60000, promise: Promise.resolve(new Map<string, Profile>()) }
    entry.promise = (async () => {
        const profiles = new Map<string, Profile>()
        try {
            const token = await getAuthToken()
            if (!token || session !== currentAuthSessionId()) return profiles
            const response = await mainHttpClient.post<{ data?: Record<string, unknown> }>('/graphql', {
                authToken: token,
                timeoutMs: 5000,
                body: {
                    query: `query ListeningRoomProfiles(${ids.map((_, i) => `$id${i}: String!`).join(', ')}) { ${ids.map((_, i) => `p${i}: findUserById(id: $id${i}) { id nickname username avatarHash avatarType }`).join(' ')} }`,
                    variables: Object.fromEntries(ids.map((id, i) => [`id${i}`, id])),
                },
            })
            if (!response.ok || !isCurrentAuthToken(token) || session !== currentAuthSessionId()) {
                entry.until = performance.now() + 5000
                return profiles
            }
            ids.forEach((id, i) => {
                const profile = record(response.data?.data?.[`p${i}`])
                const name = [profile.nickname, profile.username].find(value => typeof value === 'string' && value.trim())
                if (profile.id !== id || typeof name !== 'string') return
                const hash = profile.avatarHash
                const ext = typeof profile.avatarType === 'string' ? profile.avatarType.replace(/^\./u, '').toLowerCase() : 'webp'
                const avatarUrl =
                    typeof hash === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(hash) && /^[a-z0-9]{1,8}$/u.test(ext)
                        ? `${config.S3_URL}/avatars/${hash}${ext === 'gif' ? '_preview.webp' : `.${ext}`}`
                        : null
                profiles.set(id, { name: name.trim().slice(0, 128), avatarUrl })
            })
        } catch {
            entry.until = performance.now() + 5000
        }
        return profiles
    })()
    cached = entry
    return entry.promise
}
