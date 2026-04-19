type ProfileIdentity = {
    nickname?: string | null
    username?: string | null
}

function normalizeProfileValue(value?: string | null) {
    return String(value || '').trim()
}

export function getProfileSlug(user?: ProfileIdentity | null) {
    const username = normalizeProfileValue(user?.username)
    if (username) {
        return username
    }

    return normalizeProfileValue(user?.nickname)
}

export function isProfileSlugForUser(slug: string, user?: ProfileIdentity | null) {
    const normalizedSlug = normalizeProfileValue(slug).toLowerCase()

    if (!normalizedSlug) {
        return false
    }

    return [user?.nickname, user?.username]
        .map(value => normalizeProfileValue(value).toLowerCase())
        .filter(Boolean)
        .includes(normalizedSlug)
}
