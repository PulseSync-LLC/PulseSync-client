import { Notification } from 'electron'

import { createInstance } from 'i18next'

import { createNotificationPresenter, REALTIME_NOTIFICATION_TYPES } from '@common/notificationPresentation'

import fallbackEn from '../../locales/en/renderer.json'
import fallbackRu from '../../locales/ru/renderer.json'
import { getRendererLocalizationSnapshot } from './localization'
import { getState } from './state'

import type { NotificationItem } from '@common/notificationPresentation'
import type { TOptions } from 'i18next'

const translations = createInstance()
void translations.init({
    lng: 'ru',
    fallbackLng: 'ru',
    initAsync: false,
    resources: { en: { translation: fallbackEn }, ru: { translation: fallbackRu } },
    interpolation: { escapeValue: false },
})
let revision: string | undefined

export function translateRenderer(key: string, options?: TOptions): string {
    const snapshot = getRendererLocalizationSnapshot()
    if (snapshot?.revision !== revision) {
        revision = snapshot?.revision
        for (const language of ['en', 'ru'] as const) {
            translations.removeResourceBundle(language, 'translation')
            translations.addResourceBundle(language, 'translation', language === 'en' ? fallbackEn : fallbackRu, true, true)
            if (snapshot) translations.addResourceBundle(language, 'translation', snapshot.resources[language], true, true)
        }
    }
    const language = getState().get('settings.language') === 'en' ? 'en' : 'ru'
    return translations.t(key, { ...options, lng: language })
}

export function showBackgroundNotification(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body }).show()
}

const present = createNotificationPresenter(translateRenderer)

export function notifyBackgroundEvent(payload: unknown): void {
    const notification = (payload as { notification?: NotificationItem } | null)?.notification
    if (!notification || notification.read || !REALTIME_NOTIFICATION_TYPES.has(notification.type)) return
    const presentation = present(notification)
    showBackgroundNotification(presentation.title, presentation.body)
}
