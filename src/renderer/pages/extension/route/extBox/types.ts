import AddonInterface from '../../../../api/interfaces/addon.interface'

export type ActiveTab = 'Overview' | 'Settings' | 'Metadata'

export interface ExtensionViewProps {
    addon: AddonInterface
    isEnabled: boolean
    onToggleEnabled: (enabled: boolean) => void

    setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
    setShowFilters?: (show: boolean) => void
}
