import rendererHttpClient from '@shared/api/http/client'
import getUserToken from '@shared/lib/auth/getUserToken'

export type SubscriptionGiveaway = {
    uuid: string
    title: string
    description?: string | null
    planCode: string
    durationMonths?: number | null
    winnersCount: number
    status: string
    startsAt: string
    endsAt: string
}

type SubscriptionGiveawaysResponse = {
    giveaways?: SubscriptionGiveaway[]
    ok?: boolean
}

type EnteredSubscriptionGiveawaysResponse = {
    giveawayIds?: string[]
    ok?: boolean
}

export type SubscriptionGiveawaysSnapshot = {
    enteredIds: Set<string>
    giveaways: SubscriptionGiveaway[]
}

const CACHE_TTL_MS = 5_000

let cachedSnapshot: { authKey: string; fetchedAt: number; value: SubscriptionGiveawaysSnapshot } | null = null
let snapshotRequest: { authKey: string; promise: Promise<SubscriptionGiveawaysSnapshot> } | null = null

export async function loadSubscriptionGiveawaysSnapshot(options?: { force?: boolean }): Promise<SubscriptionGiveawaysSnapshot> {
    const authKey = getUserToken() ?? ''
    const currentRequest = snapshotRequest
    if (currentRequest && currentRequest.authKey === authKey) {
        return currentRequest.promise
    }

    const currentSnapshot = cachedSnapshot
    if (!options?.force && currentSnapshot && currentSnapshot.authKey === authKey && Date.now() - currentSnapshot.fetchedAt < CACHE_TTL_MS) {
        return currentSnapshot.value
    }

    const request = Promise.all([
        rendererHttpClient.get<SubscriptionGiveawaysResponse>('/subscription/giveaways'),
        rendererHttpClient.get<EnteredSubscriptionGiveawaysResponse>('/subscription/giveaways/entered', { auth: true }),
    ]).then(([giveawaysResponse, enteredResponse]) => {
        if (!giveawaysResponse.ok || !giveawaysResponse.data?.ok || !Array.isArray(giveawaysResponse.data.giveaways)) {
            throw new Error('Failed to load subscription giveaways')
        }
        if (!enteredResponse.ok || !enteredResponse.data?.ok || !Array.isArray(enteredResponse.data.giveawayIds)) {
            throw new Error('Failed to load entered subscription giveaways')
        }

        const value = {
            giveaways: giveawaysResponse.data.giveaways,
            enteredIds: new Set(enteredResponse.data.giveawayIds),
        }
        cachedSnapshot = {
            authKey,
            fetchedAt: Date.now(),
            value,
        }
        return value
    })
    snapshotRequest = { authKey, promise: request }

    try {
        return await request
    } finally {
        if (snapshotRequest?.promise === request) {
            snapshotRequest = null
        }
    }
}

export function invalidateSubscriptionGiveawaysSnapshot(): void {
    cachedSnapshot = null
}
