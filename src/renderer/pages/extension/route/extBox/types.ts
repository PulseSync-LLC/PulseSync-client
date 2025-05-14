import AddonInterface from '../../../../api/interfaces/addon.interface'

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

  setSelectedTags?: React.Dispatch<React.SetStateAction<Set<string>>>
  setShowFilters?: (show: boolean) => void
}