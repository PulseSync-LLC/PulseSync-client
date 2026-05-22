import type UserInterface from '@entities/user/model/user.interface'

type UserBadge = {
    uuid?: string
    name: string
    type: string
    level?: number
    createdAt?: string | number
}

const SUPPORTER_BADGE_TYPE = 'supporter'

export const hasActivePulseSyncSubscription = (user: Pick<UserInterface, 'subscription'> | null | undefined, now = Date.now()): boolean => {
    const expireAt = user?.subscription?.expireAt
    if (!expireAt) {
        return false
    }

    const expiresAtMs = new Date(expireAt).getTime()
    return Number.isFinite(expiresAtMs) && expiresAtMs > now
}

type UserBadgeSource = Pick<UserInterface, 'badges' | 'subscription'> & Partial<Pick<UserInterface, 'hasSupporterBadge'>>

export const getUserBadgesWithSubscription = (user: UserBadgeSource): UserBadge[] => {
    const badges = Array.isArray(user.badges) ? [...user.badges] : []
    const hasVisibleSupporterBadge = badges.some(badge => badge?.type === SUPPORTER_BADGE_TYPE)

    if (hasVisibleSupporterBadge || (!user.hasSupporterBadge && !hasActivePulseSyncSubscription(user))) {
        return badges
    }

    return [
        ...badges,
        {
            uuid: 'pulsesync-subscription-supporter',
            name: 'Supporter',
            type: SUPPORTER_BADGE_TYPE,
            level: 0,
        },
    ]
}
