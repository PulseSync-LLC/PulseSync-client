import React, { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MdDoneAll, MdNotificationsNone } from 'react-icons/md'
import MainEvents from '@common/types/mainEvents'
import config from '@common/appConfig'
import { useTranslation } from 'react-i18next'
import { useNotifications } from '@app/providers/notifications'
import type { NotificationItem } from '@app/providers/notifications/types'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/NotificationsBell.module.scss'

type NotificationTone = 'success' | 'error' | 'warning'

const NotificationsBell: React.FC = () => {
    const { t } = useTranslation()
    const notificationsContext = useNotifications()
    const [isOpen, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const notificationItems = notificationsContext.notifications

    useEffect(() => {
        if (!isOpen) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (rootRef.current && !rootRef.current.contains(target)) {
                setOpen(false)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        return () => document.removeEventListener('pointerdown', handlePointerDown)
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false)
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen])

    const getNotificationCopy = useCallback(
        (notification: NotificationItem) => {
            if (notification.type === 'localization.suggestion.approved') {
                return {
                    tone: 'success' as NotificationTone,
                    title: t('header.notifications.items.localizationApprovedTitle'),
                    body: t('header.notifications.items.localizationApprovedBody'),
                }
            }

            if (notification.type === 'localization.suggestion.rejected') {
                const reviewNoteValue = notification.payload?.['reviewNote']
                const reviewNote = typeof reviewNoteValue === 'string' ? reviewNoteValue.trim() : ''
                return {
                    tone: 'error' as NotificationTone,
                    title: t('header.notifications.items.localizationRejectedTitle'),
                    body: reviewNote || t('header.notifications.items.localizationRejectedBody'),
                }
            }

            return {
                tone: 'warning' as NotificationTone,
                title: t('header.notifications.items.genericTitle'),
                body: t('header.notifications.items.genericBody'),
            }
        },
        [t],
    )

    const getNotificationToneLabel = useCallback(
        (notification: NotificationItem) => {
            if (notification.category === 'localization') {
                return t('header.notifications.categories.localization')
            }

            if (notification.category === 'subscription') {
                return t('header.notifications.categories.subscription')
            }

            if (notification.category === 'security') {
                return t('header.notifications.categories.security')
            }

            return t('header.notifications.categories.system')
        },
        [t],
    )

    const getNotificationToneClassName = useCallback((tone: NotificationTone, read: boolean) => {
        if (tone === 'success') {
            return read ? styles.notificationItemSuccess : styles.notificationItemUnreadSuccess
        }

        if (tone === 'error') {
            return read ? styles.notificationItemError : styles.notificationItemUnreadError
        }

        return read ? styles.notificationItemWarning : styles.notificationItemUnreadWarning
    }, [])

    const openNotificationTarget = useCallback((notification: NotificationItem) => {
        const link = notification.link?.trim() || '/contribute/localization'
        const targetUrl = /^https?:\/\//i.test(link) ? link : `${config.WEBSITE_URL}${link.startsWith('/') ? link : `/${link}`}`
        window.desktopEvents?.send(MainEvents.OPEN_EXTERNAL, targetUrl)
    }, [])

    const handleNotificationClick = useCallback(
        async (notification: NotificationItem) => {
            setOpen(false)

            if (!notification.read) {
                await notificationsContext.markRead(notification.id)
            }

            openNotificationTarget(notification)
        },
        [notificationsContext, openNotificationTarget],
    )

    const handleMarkRead = useCallback(
        async (event: MouseEvent<HTMLButtonElement>, notificationId: string) => {
            event.stopPropagation()
            await notificationsContext.markRead(notificationId)
        },
        [notificationsContext],
    )

    const handleOpenNotification = useCallback(
        async (event: MouseEvent<HTMLButtonElement>, notification: NotificationItem) => {
            event.stopPropagation()
            await handleNotificationClick(notification)
        },
        [handleNotificationClick],
    )

    const unreadLabel = useMemo(
        () => t('header.notifications.unreadCount', { count: notificationsContext.unreadCount }),
        [notificationsContext.unreadCount, t],
    )

    const formatNotificationDate = useCallback((value: string | number) => {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
            return String(value)
        }

        return new Intl.DateTimeFormat(undefined, {
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            month: 'short',
        }).format(date)
    }, [])

    return (
        <div className={styles.notificationTrigger} ref={rootRef}>
            <TooltipButton tooltipText={t('header.notifications.open')} side="bottom" as="div">
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={t('header.notifications.open')}
                    onClick={() => setOpen(current => !current)}
                >
                    <MdNotificationsNone size={18} />
                </button>
            </TooltipButton>

            {notificationsContext.unreadCount > 0 && (
                <span className={styles.notificationBadgeCount}>
                    {notificationsContext.unreadCount > 99 ? '99+' : notificationsContext.unreadCount}
                </span>
            )}

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        className={styles.notificationsPanel}
                        role="dialog"
                        aria-label={t('header.notifications.title')}
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.985 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                        <div className={styles.notificationsHeader}>
                            <div className={styles.notificationsHeaderCopy}>
                                <div className={styles.notificationsTitle}>{t('header.notifications.title')}</div>
                                <div className={styles.notificationsSubtitle}>{unreadLabel}</div>
                            </div>
                            <button
                                type="button"
                                className={styles.notificationsAction}
                                onClick={() => void notificationsContext.markAllRead()}
                                disabled={!notificationsContext.unreadCount}
                            >
                                {t('header.notifications.markAllRead')}
                            </button>
                        </div>

                        <div className={styles.notificationsList}>
                            {notificationsContext.loading ? (
                                <div className={styles.notificationsEmpty}>{t('header.notifications.loading')}</div>
                            ) : notificationItems.length ? (
                                notificationItems.map(item => {
                                    const copy = getNotificationCopy(item)
                                    const itemClassName = getNotificationToneClassName(copy.tone, item.read)

                                    return (
                                        <motion.article
                                            layout
                                            key={item.id}
                                            className={itemClassName}
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -6 }}
                                            transition={{ duration: 0.16, ease: 'easeOut' }}
                                        >
                                            <div className={styles.notificationItemHeader}>
                                                <span className={styles.notificationTone}>{getNotificationToneLabel(item)}</span>
                                                <span className={styles.notificationItemMeta}>{formatNotificationDate(item.createdAt)}</span>
                                            </div>
                                            <div className={styles.notificationItemMain}>
                                                <div className={styles.notificationItemTitleRow}>
                                                    <div className={styles.notificationItemTitle}>{copy.title}</div>
                                                    {!item.read && <span className={styles.notificationUnreadDot} />}
                                                </div>
                                                <div className={styles.notificationItemBody}>{copy.body}</div>
                                            </div>
                                            <div className={styles.notificationItemActions}>
                                                {!item.read && (
                                                    <button
                                                        type="button"
                                                        className={styles.notificationActionSecondary}
                                                        onClick={event => void handleMarkRead(event, item.id)}
                                                    >
                                                        {t('header.notifications.read')}
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className={styles.notificationActionPrimary}
                                                    onClick={event => void handleOpenNotification(event, item)}
                                                >
                                                    {t('header.notifications.openItem')}
                                                </button>
                                            </div>
                                        </motion.article>
                                    )
                                })
                            ) : (
                                <div className={styles.notificationsEmpty}>
                                    <div className={styles.notificationsEmptyIcon}>
                                        <MdDoneAll size={18} />
                                    </div>
                                    <div className={styles.notificationsEmptyTitle}>{t('header.notifications.empty')}</div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

export default NotificationsBell
