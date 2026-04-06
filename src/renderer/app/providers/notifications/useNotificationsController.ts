import MainEvents from '@common/types/mainEvents'
import { useCallback, useEffect, useMemo, useState } from 'react'
import config from '@common/appConfig'
import getUserToken from '@shared/lib/auth/getUserToken'
import toast from '@shared/ui/toast'
import { getNotificationPresentation } from '@app/providers/notifications/presentation'
import type { NotificationsContextValue, NotificationItem } from '@app/providers/notifications/types'

type NotificationsListResponse = {
    notifications: NotificationItem[]
    ok: true
}

type NotificationsUnreadCountResponse = {
    count: number
    ok: true
}

type NotificationReadResponse = {
    count: number
    notification: NotificationItem
    ok: true
}

type NotificationCreatedPayload = {
    notification?: NotificationItem
    unreadCount?: number
}

type NotificationReadPayload = {
    notificationId?: string
    unreadCount?: number
}

type NotificationsReadAllPayload = {
    unreadCount?: number
}

type NotificationsControllerResult = {
    notificationsValue: NotificationsContextValue
    handleNotificationCreated: (payload: unknown) => void
    handleNotificationRead: (payload: unknown) => void
    handleNotificationsReadAll: (payload: unknown) => void
}

const MAX_NOTIFICATIONS = 20

function dedupeNotifications(items: NotificationItem[]): NotificationItem[] {
    const seen = new Set<string>()
    return items.filter(item => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
    })
}

export function useNotificationsController(userId: string): NotificationsControllerResult {
    const [notifications, setNotifications] = useState<NotificationItem[]>([])
    const [notificationsLoading, setNotificationsLoading] = useState(false)
    const [notificationsUnreadCount, setNotificationsUnreadCount] = useState(0)

    const requestNotifications = useCallback(async <T>(path: string, init?: RequestInit): Promise<T> => {
        const token = getUserToken()
        if (!token) {
            throw new Error('Session token is missing')
        }

        const response = await fetch(`${config.SERVER_URL}${path}`, {
            cache: 'no-store',
            ...init,
            headers: {
                Accept: 'application/json',
                ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
                authorization: `Bearer ${token}`,
                ...(init?.headers || {}),
            },
        })

        const payload = await response.json().catch((): null => null)
        if (!response.ok || payload?.ok === false) {
            throw new Error(payload?.message || payload?.error || 'Request failed')
        }

        return payload as T
    }, [])

    const resetNotifications = useCallback((): void => {
        setNotifications([])
        setNotificationsUnreadCount(0)
        setNotificationsLoading(false)
    }, [])

    const refreshNotifications = useCallback(async () => {
        if (userId === '-1') {
            resetNotifications()
            return
        }

        setNotificationsLoading(true)
        try {
            const [listPayload, unreadPayload] = await Promise.all([
                requestNotifications<NotificationsListResponse>('/notifications'),
                requestNotifications<NotificationsUnreadCountResponse>('/notifications/unread-count'),
            ])

            setNotifications(dedupeNotifications(listPayload.notifications).slice(0, MAX_NOTIFICATIONS))
            setNotificationsUnreadCount(unreadPayload.count)
        } catch {
            setNotifications([])
            setNotificationsUnreadCount(0)
        } finally {
            setNotificationsLoading(false)
        }
    }, [requestNotifications, resetNotifications, userId])

    const markNotificationRead = useCallback(
        async (id: string) => {
            if (userId === '-1') return

            const payload = await requestNotifications<NotificationReadResponse>(`/notifications/${encodeURIComponent(id)}/read`, {
                method: 'PATCH',
            })

            setNotifications(current => current.map(item => (item.id === payload.notification.id ? payload.notification : item)))
            setNotificationsUnreadCount(payload.count)
        },
        [requestNotifications, userId],
    )

    const markAllNotificationsRead = useCallback(async () => {
        if (userId === '-1') return

        const payload = await requestNotifications<NotificationsUnreadCountResponse>('/notifications/read-all', {
            method: 'PATCH',
        })

        setNotifications(current => current.map(item => ({ ...item, read: true })))
        setNotificationsUnreadCount(payload.count)
    }, [requestNotifications, userId])

    const handleNotificationCreated = useCallback((payload: unknown) => {
        const data = payload as NotificationCreatedPayload | undefined
        if (!data?.notification) return

        setNotifications(current => dedupeNotifications([data.notification as NotificationItem, ...current]).slice(0, MAX_NOTIFICATIONS))
        if (typeof data.unreadCount === 'number') {
            setNotificationsUnreadCount(data.unreadCount)
        }

        if (data.notification.type === 'achievement.completed' && !data.notification.read) {
            const presentation = getNotificationPresentation(data.notification)
            toast.custom(presentation.tone, presentation.title, presentation.body)
            window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                title: presentation.title,
                body: presentation.body,
            })
        }
    }, [])

    const handleNotificationRead = useCallback((payload: unknown) => {
        const data = payload as NotificationReadPayload | undefined
        if (data?.notificationId) {
            setNotifications(current => current.map(item => (item.id === data.notificationId ? { ...item, read: true } : item)))
        }
        if (typeof data?.unreadCount === 'number') {
            setNotificationsUnreadCount(data.unreadCount)
        }
    }, [])

    const handleNotificationsReadAll = useCallback((payload: unknown) => {
        const data = payload as NotificationsReadAllPayload | undefined
        setNotifications(current => current.map(item => ({ ...item, read: true })))
        if (typeof data?.unreadCount === 'number') {
            setNotificationsUnreadCount(data.unreadCount)
        }
    }, [])

    useEffect(() => {
        if (userId === '-1') {
            resetNotifications()
            return
        }

        void refreshNotifications()
    }, [refreshNotifications, resetNotifications, userId])

    const notificationsValue = useMemo<NotificationsContextValue>(
        () => ({
            loading: notificationsLoading,
            notifications,
            unreadCount: notificationsUnreadCount,
            refresh: refreshNotifications,
            markRead: markNotificationRead,
            markAllRead: markAllNotificationsRead,
        }),
        [markAllNotificationsRead, markNotificationRead, notifications, notificationsLoading, notificationsUnreadCount, refreshNotifications],
    )

    return {
        notificationsValue,
        handleNotificationCreated,
        handleNotificationRead,
        handleNotificationsReadAll,
    }
}
