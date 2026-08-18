import type { DeveloperToolsSection } from '@features/developerTools/DeveloperToolsPanel'
import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'

export type DeveloperSetting = 'devSocket' | 'showDevFrame'
export type GeneralSettingsSection = 'general' | 'integrations' | 'updates' | 'system'
export type SettingsSectionId = GeneralSettingsSection | 'developer' | 'experiments' | DeveloperToolsSection

export interface SettingsToggleItem {
    checked: boolean
    description?: string
    disabled?: boolean
    id: string
    kind: 'toggle'
    label: string
    onChange: (checked: boolean) => void
}

export interface SettingsActionItem {
    disabled?: boolean
    id: string
    kind: 'action'
    label: string
    onClick: () => void
}

export type SettingsItem = SettingsToggleItem | SettingsActionItem

export interface SettingsGroupSchema {
    id: string
    items: SettingsItem[]
    meta?: string
    title: string
}

export type SettingsSectionContent =
    | {
          groups: SettingsGroupSchema[]
          kind: 'groups'
      }
    | {
          kind: 'custom'
          node: ReactNode
      }

export interface SettingsSectionSchema {
    content: SettingsSectionContent
    icon: IconType
    id: SettingsSectionId
    label: string
    title: string
}

export interface SettingsCategorySchema {
    id: string
    label: string
    sections: SettingsSectionSchema[]
}
