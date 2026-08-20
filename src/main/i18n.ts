import { app } from 'electron'

import i18next from 'i18next'

import en from '../locales/bundled/en/main.json'
import ru from '../locales/bundled/ru/main.json'

import type { TOptions } from 'i18next'

type MainTranslateOptions = Omit<TOptions, 'defaultValue'>

const normalizeLocale = (locale?: string): string => {
    if (!locale) return 'ru'
    return locale.split('-')[0].toLowerCase()
}

export const initMainI18n = (storedLanguage?: unknown): typeof i18next => {
    if (i18next.isInitialized) return i18next
    const locale = normalizeLocale(app.getLocale?.())
    const detectedLanguage = locale === 'en' ? 'en' : 'ru'
    const language = storedLanguage === 'en' || storedLanguage === 'ru' ? (storedLanguage as string) : detectedLanguage
    i18next.init({
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
    return i18next
}

export const t = (key: string, options?: MainTranslateOptions): string => (options ? i18next.t(key, options) : i18next.t(key))
