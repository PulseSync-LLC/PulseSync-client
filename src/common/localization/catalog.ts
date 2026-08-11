export const LOCALIZATION_CATALOG_SCHEMA_VERSION = 1 as const
export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export type TranslationTree = { [key: string]: string | TranslationTree }

export interface RemoteLocalizationCatalog {
    schemaVersion: typeof LOCALIZATION_CATALOG_SCHEMA_VERSION
    revision: string
    requiresDesktopApi: string
    resources: Record<
        SupportedLanguage,
        {
            main: TranslationTree
            renderer: TranslationTree
        }
    >
}

export interface DesktopLocalizationSnapshot {
    schemaVersion: typeof LOCALIZATION_CATALOG_SCHEMA_VERSION
    revision: string
    resources: Record<SupportedLanguage, TranslationTree>
}

export const serializeLocalizationRevisionInput = (catalog: Pick<RemoteLocalizationCatalog, 'requiresDesktopApi' | 'resources'>): string =>
    JSON.stringify({ requiresDesktopApi: catalog.requiresDesktopApi, resources: catalog.resources })

const isTranslationTree = (value: unknown, depth = 0): value is TranslationTree => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 32) return false

    for (const [key, child] of Object.entries(value)) {
        if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') return false
        if (typeof child !== 'string' && !isTranslationTree(child, depth + 1)) return false
    }

    return true
}

export const parseRemoteLocalizationCatalog = (value: unknown): RemoteLocalizationCatalog | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const catalog = value as Partial<RemoteLocalizationCatalog>
    if (catalog.schemaVersion !== LOCALIZATION_CATALOG_SCHEMA_VERSION) return null
    if (typeof catalog.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(catalog.revision)) return null
    if (typeof catalog.requiresDesktopApi !== 'string' || !catalog.requiresDesktopApi.trim()) return null
    if (!catalog.resources || typeof catalog.resources !== 'object' || Array.isArray(catalog.resources)) return null

    for (const language of SUPPORTED_LANGUAGES) {
        const resources = catalog.resources[language]
        if (!resources || !isTranslationTree(resources.main) || !isTranslationTree(resources.renderer)) return null
    }

    return catalog as RemoteLocalizationCatalog
}
