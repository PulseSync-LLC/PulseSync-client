import i18next, { TOptions } from 'i18next'
import { app } from 'electron'

import en from '../locales/en/main.json'
import ru from '../locales/ru/main.json'

const normalizeLocale = (locale?: string): string => {
    if (!locale) return 'ru'
    return locale.split('-')[0].toLowerCase()
}

export const initMainI18n = (): typeof i18next => {
    if (i18next.isInitialized) return i18next
    const locale = normalizeLocale(app.getLocale?.())
    const language = locale === 'en' ? 'en' : 'ru'
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

export const t = (key: string, options?: TOptions): string => i18next.t(key, options)
