import AddonInterface from '@entities/addon/model/addon.interface'
import type { StoreAddon, StoreAddonRelease } from '@entities/addon/model/storeAddon.interface'

export const PUBLICATION_CHANGELOG_TAB = 'Changes'

export interface DocTab {
    title: string
    content: string
    isMarkdown: boolean
}

export type ActiveTab = string

export interface ExtensionViewProps {
    addon: AddonInterface
    isEnabled: boolean
    onToggleEnabled: (enabled: boolean) => void
    hasStoreUpdate?: boolean
    storeUpdateBusy?: boolean
    onStoreUpdate?: () => void
    publication?: StoreAddon | null
    publicationReleases?: StoreAddonRelease[]
    publicationChangelogText?: string
    publicationGithubUrlText?: string
    canManagePublication?: boolean
    publicationBusy?: boolean
    onPublicationChangelogChange?: (value: string) => void
    onPublicationGithubUrlChange?: (value: string) => void
    onPublishAddon?: (changelogText: string, githubUrl: string, usedAiDuringDevelopment: boolean) => void
    onUpdateAddon?: (changelogText: string, githubUrl: string, usedAiDuringDevelopment: boolean) => void

    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}
