import { t } from '@app/i18n'

import type { NotificationItem } from '@app/providers/notifications/types'

export type NotificationTone = 'success' | 'error' | 'warning'

export type NotificationPresentation = {
    body: string
    title: string
    tone: NotificationTone
}

function formatPayloadDate(value: unknown): string {
    const rawValue = typeof value === 'string' ? value : ''
    const date = new Date(rawValue)
    if (Number.isNaN(date.getTime())) {
        return t('header.notifications.items.subscriptionFallbackDate')
    }

    return new Intl.DateTimeFormat(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date)
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

        case 'subscription.giveaway.won': {
            const giveawayTitle = String(notification.payload?.['giveawayTitle'] || t('header.notifications.items.giveawayFallbackTitle'))
            const planName = String(notification.payload?.['planName'] || t('header.notifications.items.giveawayFallbackPrize'))
            const durationMonths = Number(notification.payload?.['durationMonths'] || 0)
            const prize = durationMonths > 0 ? t('header.notifications.items.giveawayWonPrize', { name: planName, months: durationMonths }) : planName
            return {
                tone: 'success',
                title: t('header.notifications.items.giveawayWonTitle'),
                body: t('header.notifications.items.giveawayWonBody', {
                    giveaway: giveawayTitle,
                    prize,
                }),
            }
        }

        case 'subscription.giveaway.started': {
            const giveawayTitle = String(notification.payload?.['giveawayTitle'] || t('header.notifications.items.giveawayFallbackTitle'))
            return {
                tone: 'success',
                title: t('header.notifications.items.giveawayStartedTitle'),
                body: t('header.notifications.items.giveawayStartedBody', {
                    giveaway: giveawayTitle,
                    date: formatPayloadDate(notification.payload?.['endsAt']),
                }),
            }
        }

        case 'subscription.purchase.succeeded': {
            const planName = String(
                notification.payload?.['planName'] ||
                    notification.payload?.['subscriptionName'] ||
                    t('header.notifications.items.subscriptionFallbackPlan'),
            )
            return {
                tone: 'success',
                title: t('header.notifications.items.subscriptionPurchaseSucceededTitle'),
                body: t('header.notifications.items.subscriptionPurchaseSucceededBody', {
                    plan: planName,
                    date: formatPayloadDate(notification.payload?.['expireAt']),
                }),
            }
        }

        case 'subscription.expiring.soon': {
            const planName = String(
                notification.payload?.['subscriptionName'] ||
                    notification.payload?.['planName'] ||
                    t('header.notifications.items.subscriptionFallbackPlan'),
            )
            return {
                tone: 'warning',
                title: t('header.notifications.items.subscriptionExpiringSoonTitle'),
                body: t('header.notifications.items.subscriptionExpiringSoonBody', {
                    plan: planName,
                    date: formatPayloadDate(notification.payload?.['expireAt']),
                }),
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
