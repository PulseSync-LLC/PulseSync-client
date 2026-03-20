export type StoreAddonStatus = 'pending' | 'rejected' | 'accepted'
export type StoreAddonKind = 'theme' | 'script'

export interface StoreAddon {
    id: string
    name: string
    description: string
    type: StoreAddonKind
    version: string
    authors: string[]
    changelog?: string[] | null
    avatarUrl?: string | null
    bannerUrl?: string | null
    downloadUrl: string
    approvedAt?: string | null
    status: StoreAddonStatus
    moderationNote?: string | null
    createdAt: string
    updatedAt: string
}

export interface StoreAddonsPayload {
    addons: StoreAddon[]
    totalCount: number
    totalPages: number
}
