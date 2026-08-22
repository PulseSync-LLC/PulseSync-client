export const SETTINGS_DEEP_LINK_SECTIONS = [
    'general',
    'integrations',
    'updates',
    'system',
    'developer',
    'experiments',
    'metrics',
    'components',
    'navigation',
] as const

export type SettingsDeepLinkSection = (typeof SETTINGS_DEEP_LINK_SECTIONS)[number]

export type OpenSettingsModalPayload = {
    activeSection: SettingsDeepLinkSection
    modalName: 'SETTINGS'
}

export const isSettingsDeepLinkSection = (value: unknown): value is SettingsDeepLinkSection =>
    typeof value === 'string' && SETTINGS_DEEP_LINK_SECTIONS.some(section => section === value)
