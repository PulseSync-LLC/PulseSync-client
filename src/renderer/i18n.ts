import i18next, { TOptions } from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '../locales/en/renderer.json'
import ru from '../locales/ru/renderer.json'

const normalizeLocale = (locale?: string): string => {
    if (!locale) return 'ru'
    return locale.split('-')[0].toLowerCase()
}

const language = (() => {
    if (typeof navigator === 'undefined') return 'ru'
    const normalized = normalizeLocale(navigator.language)
    return normalized === 'en' ? 'en' : 'ru'
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
