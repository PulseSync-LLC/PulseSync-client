import { t } from '@app/i18n'
import type { NotificationItem } from '@app/providers/notifications/types'

export type NotificationTone = 'success' | 'error' | 'warning'

export type NotificationPresentation = {
    body: string
    title: string
    tone: NotificationTone
}

export function getNotificationPresentation(notification: NotificationItem): NotificationPresentation {
    switch (notification.type) {
        case 'addon.review.pending':
            return {
                tone: 'warning',
                title: t('header.notifications.items.addonPendingTitle'),
                body: t('header.notifications.items.addonPendingBody', {
                    name: String(notification.payload?.['name'] || t('store.unknownAddon')),
                }),
            }

        case 'addon.review.accepted':
            return {
                tone: 'success',
                title: t('header.notifications.items.addonAcceptedTitle'),
                body: t('header.notifications.items.addonAcceptedBody', {
                    name: String(notification.payload?.['name'] || t('store.unknownAddon')),
                }),
            }

        case 'addon.review.rejected': {
            const reviewNoteValue = notification.payload?.['moderationNote']
            const reviewNote = typeof reviewNoteValue === 'string' ? reviewNoteValue.trim() : ''
            return {
                tone: 'error',
                title: t('header.notifications.items.addonRejectedTitle'),
                body:
                    reviewNote ||
                    t('header.notifications.items.addonRejectedBody', {
                        name: String(notification.payload?.['name'] || t('store.unknownAddon')),
                    }),
            }
        }

        case 'achievement.completed': {
            const achievementTitle = String(notification.payload?.['title'] || t('profile.achievements.title'))
            const points = Number(notification.payload?.['points'] || 0)
            return {
                tone: 'success',
                title: t('header.notifications.items.achievementCompletedTitle'),
                body: t('header.notifications.items.achievementCompletedBody', {
                    title: achievementTitle,
                    points,
                }),
            }
        }

        case 'localization.suggestion.approved':
            return {
                tone: 'success',
                title: t('header.notifications.items.localizationApprovedTitle'),
                body: t('header.notifications.items.localizationApprovedBody'),
            }

        case 'localization.suggestion.rejected': {
            const reviewNoteValue = notification.payload?.['reviewNote']
            const reviewNote = typeof reviewNoteValue === 'string' ? reviewNoteValue.trim() : ''
            return {
                tone: 'error',
                title: t('header.notifications.items.localizationRejectedTitle'),
                body: reviewNote || t('header.notifications.items.localizationRejectedBody'),
            }
        }

        default:
            return {
                tone: 'warning',
                title: t('header.notifications.items.genericTitle'),
                body: t('header.notifications.items.genericBody'),
            }
    }
}
