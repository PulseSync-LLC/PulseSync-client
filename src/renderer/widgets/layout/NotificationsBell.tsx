import React, { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@pulsesync/uikit/actions'
import { Tooltip } from '@pulsesync/uikit/feedback'
import { AnimatePresence, motion } from 'framer-motion'
import { MdDoneAll } from 'react-icons/md'
import config from '@common/appConfig'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '@app/providers/notifications'
import { useModalContext } from '@app/providers/modal'
import { getNotificationPresentation, NotificationTone } from '@app/providers/notifications/presentation'
import type { NotificationItem } from '@app/providers/notifications/types'
import Loader from '@shared/ui/PSUI/Loader'
import * as styles from '@widgets/layout/NotificationsBell.module.scss'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'

const WEBSITE_ORIGIN = (() => {
    try {
        return new URL(config.WEBSITE_URL).origin
    } catch {
        return null
    }
})()

function getInternalNotificationPath(link: string | null | undefined): string | null {
    if (!WEBSITE_ORIGIN) {
        return null
    }

    const rawLink = link?.trim()
    if (!rawLink) {
        return null
    }

    try {
        const url = new URL(rawLink, WEBSITE_ORIGIN)
        if (url.origin !== WEBSITE_ORIGIN) {
            return null
        }

        const pathname = url.pathname.endsWith('/') && url.pathname !== '/' ? url.pathname.slice(0, -1) : url.pathname
        const isInternalPath =
            pathname === '/' ||
            pathname === '/auth' ||
            pathname === '/auth/callback' ||
            pathname === '/joint' ||
            pathname === '/store' ||
            pathname === '/users' ||
            /^\/profile\/[^/?#]+$/i.test(pathname)

        return isInternalPath ? `${pathname}${url.search}${url.hash}` : null
    } catch {
        return null
    }
}

const NotificationsBell: React.FC = () => {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const notificationsContext = useNotifications()
    const { Modals, openModal } = useModalContext()
    const [isOpen, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const notificationItems = notificationsContext.notifications
    const hasUnreadNotifications = notificationsContext.unreadCount > 0

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

    const getNotificationCopy = useCallback((notification: NotificationItem) => getNotificationPresentation(notification), [])

    const getNotificationToneLabel = useCallback(
        (notification: NotificationItem) => {
            if (notification.category === 'addon') {
                return t('header.notifications.categories.addon')
            }

            if (notification.category === 'achievement') {
                return t('header.notifications.categories.achievement')
            }

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

    const openNotificationTarget = useCallback(
        (notification: NotificationItem) => {
            if (notification.type === 'subscription.giveaway.started') {
                openModal(Modals.SUBSCRIPTION_GIVEAWAYS)
                return
            }

            const internalPath = getInternalNotificationPath(notification.link)
            if (internalPath) {
                void navigate(internalPath)
                return
            }

            const rawLink = notification.link?.trim()
            const externalUrl = !rawLink
                ? `${config.WEBSITE_URL}/contribute/localization`
                : /^https?:\/\//i.test(rawLink)
                  ? rawLink
                  : `${config.WEBSITE_URL}${rawLink.startsWith('/') ? rawLink : `/${rawLink}`}`

            desktopApi.system.openExternal(externalUrl)
        },
        [Modals.SUBSCRIPTION_GIVEAWAYS, navigate, openModal],
    )

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
            <Tooltip content={t('header.notifications.open')} position="bottom">
                <IconButton variant="ghost" size="compact" aria-label={t('header.notifications.open')} onClick={() => setOpen(current => !current)}>
                    <img
                        className={hasUnreadNotifications ? styles.headerBellIcon : `${styles.headerBellIcon} ${styles.headerBellIconIdle}`}
                        src={staticAsset(hasUnreadNotifications ? 'assets/icons/ui/header-bell.svg' : 'assets/icons/ui/header-bell-idle.svg')}
                        alt=""
                        aria-hidden="true"
                    />
                </IconButton>
            </Tooltip>

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
                                <div className={styles.notificationsEmpty}>
                                    <Loader variant="panel" />
                                </div>
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
