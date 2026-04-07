export type StoreAddonStatus = 'pending' | 'rejected' | 'accepted'
export type StoreAddonKind = 'theme' | 'script'

export interface StoreAddonRelease {
    id: string
    version: string
    description: string
    githubUrl?: string | null
    authors: string[]
    changelog?: string[] | null
    avatarUrl?: string | null
    bannerUrl?: string | null
    downloadUrl?: string | null
    approvedAt?: string | null
    status: StoreAddonStatus
    moderationNote?: string | null
    createdAt: string
    updatedAt: string
}

export interface StoreAddon {
    id: string
    name: string
    type: StoreAddonKind
    downloadCount: number
    currentRelease?: StoreAddonRelease | null
    releases?: StoreAddonRelease[] | null
    submittedById?: string | null
    submittedByUsername?: string | null
    submittedByNickname?: string | null
    createdAt: string
    updatedAt: string
}

export interface StoreAddonsPayload {
    addons: StoreAddon[]
    totalCount: number
    totalPages: number
}
