import i18next, { TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '../../locales/en/renderer.json'
import ru from '../../locales/ru/renderer.json'

const normalizeLocale = (locale?: string): string => {
    if (!locale) return 'ru'
    return locale.split('-')[0].toLowerCase()
}
const supportedLanguages = ['en', 'ru'] as const
const languageStorageKey = 'pulsesync:language'

export const normalizeSupportedLanguage = (language?: string): (typeof supportedLanguages)[number] => {
    const normalized = normalizeLocale(language)
    return normalized === 'en' ? 'en' : 'ru'
}

export const rememberLanguage = (language: string): void => {
    try {
        window.localStorage.setItem(languageStorageKey, normalizeSupportedLanguage(language))
    } catch {
        // ignore storage errors
    }
}

const getCachedLanguage = (): (typeof supportedLanguages)[number] | null => {
    try {
        const stored = window.localStorage.getItem(languageStorageKey)
        if (supportedLanguages.includes(stored as (typeof supportedLanguages)[number])) {
            return stored as (typeof supportedLanguages)[number]
        }
    } catch {
        return null
    }

    return null
}

const language = (() => {
    if (typeof navigator === 'undefined') return 'ru'
    const cachedLanguage = getCachedLanguage()
    if (cachedLanguage) return cachedLanguage
    return normalizeSupportedLanguage(navigator.language)
})()

if (!i18next.isInitialized) {
    i18next.use(initReactI18next).init({
        lng: language,
        fallbackLng: 'ru',
        resources: {
            en: { translation: en },
            ru: { translation: ru },
        },
        interpolation: {
            escapeValue: false,
        },
    })
}

export const t = (key: string, options?: TOptions): string => i18next.t(key, options as any) as string
export default i18next
