import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MdRedeem } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import { useNotifications } from '@app/providers/notifications'
import { loadSubscriptionGiveawaysSnapshot } from '@shared/api/subscriptionGiveaways'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'

const REFRESH_INTERVAL_MS = 60_000

const SubscriptionGiveawaysButton: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, isModalOpen, openModal } = useModalContext()
    const { notifications } = useNotifications()
    const [activeCount, setActiveCount] = useState(0)
    const giveawaysModalOpen = isModalOpen(Modals.SUBSCRIPTION_GIVEAWAYS)
    const wasGiveawaysModalOpen = useRef(giveawaysModalOpen)
    const latestStartedNotificationId = useMemo(
        () => notifications.find(notification => notification.type === 'subscription.giveaway.started')?.id ?? null,
        [notifications],
    )

    const refreshActiveCount = useCallback(async () => {
        try {
            const snapshot = await loadSubscriptionGiveawaysSnapshot()
            const now = Date.now()
            const count = snapshot.giveaways.filter(giveaway => {
                const startsAt = new Date(giveaway.startsAt).getTime()
                const endsAt = new Date(giveaway.endsAt).getTime()
                return (
                    !snapshot.enteredIds.has(giveaway.uuid) &&
                    giveaway.status === 'open' &&
                    Number.isFinite(startsAt) &&
                    Number.isFinite(endsAt) &&
                    startsAt <= now &&
                    endsAt > now
                )
            }).length

            setActiveCount(count)
        } catch (error) {
            console.error('Failed to refresh active subscription giveaway count:', error)
            setActiveCount(0)
        }
    }, [])

    useEffect(() => {
        void refreshActiveCount()
        const intervalId = window.setInterval(() => void refreshActiveCount(), REFRESH_INTERVAL_MS)
        return () => window.clearInterval(intervalId)
    }, [refreshActiveCount])

    useEffect(() => {
        if (latestStartedNotificationId) {
            void refreshActiveCount()
        }
    }, [latestStartedNotificationId, refreshActiveCount])

    useEffect(() => {
        const wasOpen = wasGiveawaysModalOpen.current
        wasGiveawaysModalOpen.current = giveawaysModalOpen
        if (wasOpen && !giveawaysModalOpen) {
            void refreshActiveCount()
        }
    }, [giveawaysModalOpen, refreshActiveCount])

    return (
        <TooltipButton tooltipText={t('header.giveaways.open')} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button
                type="button"
                className={styles.headerIconButton}
                aria-label={t('header.giveaways.open')}
                onClick={() => openModal(Modals.SUBSCRIPTION_GIVEAWAYS)}
            >
                <MdRedeem size={18} />
            </button>
            {activeCount > 0 && <span className={styles.giveawaysBadge}>{activeCount > 99 ? '99+' : activeCount}</span>}
        </TooltipButton>
    )
}

export default SubscriptionGiveawaysButton
