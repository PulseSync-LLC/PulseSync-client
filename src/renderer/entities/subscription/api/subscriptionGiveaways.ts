import apolloClient from '@shared/api/apolloClient'
import { getUserTokenAsync } from '@shared/lib/auth/getUserToken'

import EnterSubscriptionGiveaway from './enterSubscriptionGiveaway.mutation'
import GetSubscriptionGiveaways from './getSubscriptionGiveaways.query'

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
    getSubscriptionGiveaways: SubscriptionGiveaway[]
    getEnteredSubscriptionGiveawayIds: string[]
}

export type SubscriptionGiveawaysSnapshot = {
    enteredIds: Set<string>
    giveaways: SubscriptionGiveaway[]
}

const CACHE_TTL_MS = 5 * 60_000

const requestContext = (token: string) => ({
    authToken: token,
    queryDeduplication: false,
    fetchOptions: { signal: AbortSignal.timeout(15_000) },
})

let cachedSnapshot: { authKey: string; fetchedAt: number; value: SubscriptionGiveawaysSnapshot } | null = null
let snapshotRequest: { authKey: string; promise: Promise<SubscriptionGiveawaysSnapshot> } | null = null

export async function loadSubscriptionGiveawaysSnapshot(options?: { force?: boolean }): Promise<SubscriptionGiveawaysSnapshot> {
    const authKey = (await getUserTokenAsync()) ?? ''
    if (!authKey) return { giveaways: [], enteredIds: new Set() }
    const currentRequest = snapshotRequest
    if (currentRequest && currentRequest.authKey === authKey) {
        return currentRequest.promise
    }

    const currentSnapshot = cachedSnapshot
    if (!options?.force && currentSnapshot && currentSnapshot.authKey === authKey && Date.now() - currentSnapshot.fetchedAt < CACHE_TTL_MS) {
        return currentSnapshot.value
    }

    const request = apolloClient
        .query<SubscriptionGiveawaysResponse>({
            query: GetSubscriptionGiveaways,
            fetchPolicy: 'no-cache',
            context: requestContext(authKey),
        })
        .then(({ data }) => {
            if (!Array.isArray(data?.getSubscriptionGiveaways) || !Array.isArray(data?.getEnteredSubscriptionGiveawayIds)) {
                throw new Error('Failed to load subscription giveaways snapshot')
            }

            const value = {
                giveaways: data.getSubscriptionGiveaways,
                enteredIds: new Set(data.getEnteredSubscriptionGiveawayIds),
            }
            if (snapshotRequest?.promise === request) {
                cachedSnapshot = {
                    authKey,
                    fetchedAt: Date.now(),
                    value,
                }
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
    snapshotRequest = null
}

export async function enterSubscriptionGiveaway(id: string): Promise<void> {
    const token = await getUserTokenAsync()
    if (!token) throw new Error('Subscription giveaway authentication required')
    const result = await apolloClient.mutate<{ enterSubscriptionGiveaway: { uuid: string } }>({
        mutation: EnterSubscriptionGiveaway,
        variables: { id },
        fetchPolicy: 'no-cache',
        context: requestContext(token),
    })
    if (!result.data?.enterSubscriptionGiveaway?.uuid) throw new Error('Failed to enter subscription giveaway')
    invalidateSubscriptionGiveawaysSnapshot()
}
