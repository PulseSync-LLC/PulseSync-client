import AddonInterface from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'

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
    publication?: StoreAddon | null
    canManagePublication?: boolean
    publicationBusy?: boolean
    onPublishAddon?: () => void
    onUpdateAddon?: () => void

    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}
