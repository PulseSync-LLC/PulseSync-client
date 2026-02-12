import userInitials from '../initials/user.initials'
import UserInterface from '../interfaces/user.interface'

export type UserUpdatePayload = {
    user: Partial<UserInterface> & { id: string }
}

export type SubscriptionUpdatePayload = {
    userId: string
    user: Partial<UserInterface> & { id: string }
    hasSupporterBadge: boolean
    subscription: UserInterface['subscription']
    active: boolean
}

function usersAreEqual(a: UserInterface, b: UserInterface): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b)
    } catch {
        return false
    }
}

function normalizeIncomingUser(
    incoming: Partial<UserInterface>,
    patch?: Partial<Pick<UserInterface, 'subscription' | 'hasSupporterBadge' | 'active'>>,
): UserInterface {
    return {
        ...userInitials,
        ...incoming,
        levelInfo: {
            ...userInitials.levelInfo,
            ...(incoming.levelInfo || {}),
        },
        badges: Array.isArray(incoming.badges) ? incoming.badges : [],
        userAchievements: Array.isArray(incoming.userAchievements) ? incoming.userAchievements : [],
        subscription:
            patch && Object.prototype.hasOwnProperty.call(patch, 'subscription')
                ? patch.subscription ?? null
                : incoming.subscription ?? null,
        hasSupporterBadge:
            patch && Object.prototype.hasOwnProperty.call(patch, 'hasSupporterBadge')
                ? Boolean(patch.hasSupporterBadge)
                : Boolean(incoming.hasSupporterBadge),
        active:
            patch && Object.prototype.hasOwnProperty.call(patch, 'active')
                ? Boolean(patch.active)
                : Boolean(incoming.active),
    }
}

export function applyUserUpdate(currentUser: UserInterface, payload: UserUpdatePayload | null | undefined): UserInterface {
    const incomingUser = payload?.user
    if (!incomingUser?.id || incomingUser.id !== currentUser.id) {
        return currentUser
    }

    const nextUser = normalizeIncomingUser(incomingUser)
    return usersAreEqual(currentUser, nextUser) ? currentUser : nextUser
}

export function applySubscriptionUpdate(
    currentUser: UserInterface,
    payload: SubscriptionUpdatePayload | null | undefined,
): UserInterface {
    if (!payload?.userId || payload.userId !== currentUser.id || !payload.user?.id) {
        return currentUser
    }

    const nextUser = normalizeIncomingUser(payload.user, {
        subscription: payload.subscription ?? null,
        hasSupporterBadge: payload.hasSupporterBadge,
        active: payload.active,
    })

    return usersAreEqual(currentUser, nextUser) ? currentUser : nextUser
}
