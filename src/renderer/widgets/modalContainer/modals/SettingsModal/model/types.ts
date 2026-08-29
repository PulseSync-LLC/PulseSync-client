import type { SettingsDeepLinkSection } from '@common/settingsDeepLink'
import type { ReactNode } from 'react'
import type { IconType } from 'react-icons'

export type DeveloperSetting = 'devSocket' | 'showDevFrame'
export type SettingsSectionId = SettingsDeepLinkSection

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

export interface SettingsChoiceItem {
    description?: string
    disabled?: boolean
    id: string
    kind: 'choice'
    label: string
    onSelect: () => void
    selected: boolean
}

export type SettingsItem = SettingsToggleItem | SettingsActionItem | SettingsChoiceItem

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
