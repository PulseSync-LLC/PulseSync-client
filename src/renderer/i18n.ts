import i18next, { TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '../locales/en/renderer.json'
import ru from '../locales/ru/renderer.json'

const normalizeLocale = (locale?: string): string => {
    if (!locale) return 'ru'
    return locale.split('-')[0].toLowerCase()
}
const supportedLanguages = ['en', 'ru'] as const

const getStoredLanguage = (): (typeof supportedLanguages)[number] | null => {
    try {
        const stored = window?.electron?.store?.get?.('settings.language')
        if (typeof stored === 'string') {
            const normalized = normalizeLocale(stored)
            if (supportedLanguages.includes(normalized as (typeof supportedLanguages)[number])) {
                return normalized as (typeof supportedLanguages)[number]
            }
        }
    } catch {
        return null
    }
    return null
}

const language = (() => {
    if (typeof navigator === 'undefined') return 'ru'
    const storedLanguage = getStoredLanguage()
    if (storedLanguage) return storedLanguage
    const normalized = normalizeLocale(navigator.language)
    const detectedLanguage = normalized === 'en' ? 'en' : 'ru'
    try {
        window?.electron?.store?.set?.('settings.language', detectedLanguage)
    } catch {
        // ignore storage errors
    }
    return detectedLanguage
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

export const t = (key: string, options?: TOptions): string => i18next.t(key, options)
export default i18next
