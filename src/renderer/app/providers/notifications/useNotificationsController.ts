import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getNotificationPresentation } from '@app/providers/notifications/presentation'
import rendererHttpClient from '@shared/api/http/client'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import type { NotificationItem, NotificationsContextValue } from '@app/providers/notifications/types'

type NotificationsListResponse = {
    notifications: NotificationItem[]
    hasMore?: boolean
    nextCursor?: string | null
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

const NOTIFICATIONS_PAGE_SIZE = 20
const REALTIME_TOAST_NOTIFICATION_TYPES = new Set([
    'achievement.completed',
    'subscription.giveaway.started',
    'subscription.giveaway.won',
    'subscription.purchase.succeeded',
    'subscription.expiring.soon',
])

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
    const [loadingMore, setLoadingMore] = useState(false)
    const [loadMoreError, setLoadMoreError] = useState(false)
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const generationRef = useRef(0)
    const nextPagePendingRef = useRef(false)
    const refreshPendingRef = useRef(false)
    const unreadVersionRef = useRef(0)
    const createdDuringRefreshRef = useRef<NotificationItem[]>([])
    const readIdsRef = useRef(new Set<string>())
    const readAllVersionRef = useRef(0)

    const requestNotifications = useCallback(
        async <T>(path: string, options?: { body?: unknown; method?: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE' }): Promise<T> => {
            const response = await rendererHttpClient.request<T>({
                url: path,
                method: options?.method || 'GET',
                auth: true,
                body: options?.body,
                headers: {
                    Accept: 'application/json',
                },
            })

            const payload = response.data as any
            if (!response.ok || payload?.ok === false) {
                throw new Error(payload?.message || payload?.error || 'Request failed')
            }

            return payload as T
        },
        [],
    )

    const resetNotifications = useCallback((): void => {
        generationRef.current += 1
        nextPagePendingRef.current = false
        refreshPendingRef.current = false
        createdDuringRefreshRef.current = []
        readIdsRef.current.clear()
        setNotifications([])
        setNotificationsUnreadCount(0)
        setNotificationsLoading(false)
        setLoadingMore(false)
        setLoadMoreError(false)
        setNextCursor(null)
    }, [])

    const refreshNotifications = useCallback(async () => {
        if (userId === '-1') {
            resetNotifications()
            return
        }

        const generation = ++generationRef.current
        const unreadVersion = unreadVersionRef.current
        const readAllVersion = readAllVersionRef.current
        nextPagePendingRef.current = false
        refreshPendingRef.current = true
        createdDuringRefreshRef.current = []
        setNotificationsLoading(true)
        setLoadingMore(false)
        setLoadMoreError(false)
        setNextCursor(null)
        try {
            const [listPayload, unreadPayload] = await Promise.all([
                requestNotifications<NotificationsListResponse>('/notifications?limit=' + NOTIFICATIONS_PAGE_SIZE),
                requestNotifications<NotificationsUnreadCountResponse>('/notifications/unread-count'),
            ])
            if (generation !== generationRef.current) return

            const page = listPayload.notifications.map(item =>
                readIdsRef.current.has(item.id) || readAllVersion !== readAllVersionRef.current ? { ...item, read: true } : item,
            )
            setNotifications(dedupeNotifications([...createdDuringRefreshRef.current, ...page]))
            setNextCursor(listPayload.hasMore && listPayload.nextCursor ? listPayload.nextCursor : null)
            if (unreadVersion === unreadVersionRef.current) setNotificationsUnreadCount(unreadPayload.count)
        } catch {
            if (generation !== generationRef.current) return
            setNotifications(createdDuringRefreshRef.current)
        } finally {
            if (generation === generationRef.current) {
                refreshPendingRef.current = false
                createdDuringRefreshRef.current = []
                setNotificationsLoading(false)
            }
        }
    }, [requestNotifications, resetNotifications, userId])

    const loadMoreNotifications = useCallback(async () => {
        if (userId === '-1' || !nextCursor || refreshPendingRef.current || nextPagePendingRef.current) return
        const generation = generationRef.current
        const readAllVersion = readAllVersionRef.current
        nextPagePendingRef.current = true
        setLoadingMore(true)
        setLoadMoreError(false)
        try {
            const payload = await requestNotifications<NotificationsListResponse>(
                '/notifications?limit=' + NOTIFICATIONS_PAGE_SIZE + '&cursor=' + encodeURIComponent(nextCursor),
            )
            if (generation !== generationRef.current) return
            const page = payload.notifications.map(item =>
                readIdsRef.current.has(item.id) || readAllVersion !== readAllVersionRef.current ? { ...item, read: true } : item,
            )
            setNotifications(current => dedupeNotifications([...current, ...page]))
            setNextCursor(payload.hasMore && payload.nextCursor && payload.nextCursor !== nextCursor ? payload.nextCursor : null)
        } catch {
            if (generation === generationRef.current) setLoadMoreError(true)
        } finally {
            if (generation === generationRef.current) {
                nextPagePendingRef.current = false
                setLoadingMore(false)
            }
        }
    }, [nextCursor, requestNotifications, userId])

    const markNotificationRead = useCallback(
        async (id: string) => {
            if (userId === '-1') return

            const generation = generationRef.current
            const payload = await requestNotifications<NotificationReadResponse>(`/notifications/${encodeURIComponent(id)}/read`, {
                method: 'PATCH',
            })

            if (generation !== generationRef.current) return
            readIdsRef.current.add(payload.notification.id)
            unreadVersionRef.current += 1
            createdDuringRefreshRef.current = createdDuringRefreshRef.current.map(item =>
                item.id === payload.notification.id ? payload.notification : item,
            )
            setNotifications(current => current.map(item => (item.id === payload.notification.id ? payload.notification : item)))
            setNotificationsUnreadCount(payload.count)
        },
        [requestNotifications, userId],
    )

    const markAllNotificationsRead = useCallback(async () => {
        if (userId === '-1') return

        const generation = generationRef.current
        const payload = await requestNotifications<NotificationsUnreadCountResponse>('/notifications/read-all', {
            method: 'PATCH',
        })

        if (generation !== generationRef.current) return
        readAllVersionRef.current += 1
        unreadVersionRef.current += 1
        createdDuringRefreshRef.current = createdDuringRefreshRef.current.map(item => ({ ...item, read: true }))
        setNotifications(current => current.map(item => ({ ...item, read: true })))
        setNotificationsUnreadCount(payload.count)
    }, [requestNotifications, userId])

    const handleNotificationCreated = useCallback((payload: unknown) => {
        const data = payload as NotificationCreatedPayload | undefined
        if (!data?.notification) return

        if (refreshPendingRef.current) createdDuringRefreshRef.current = dedupeNotifications([data.notification, ...createdDuringRefreshRef.current])
        setNotifications(current => dedupeNotifications([data.notification as NotificationItem, ...current]))
        if (typeof data.unreadCount === 'number') {
            unreadVersionRef.current += 1
            setNotificationsUnreadCount(data.unreadCount)
        }

        if (REALTIME_TOAST_NOTIFICATION_TYPES.has(data.notification.type) && !data.notification.read) {
            const presentation = getNotificationPresentation(data.notification)
            toast.custom(presentation.tone, presentation.title, presentation.body)
            desktopApi.system.showNotification({
                title: presentation.title,
                body: presentation.body,
            })
        }
    }, [])

    const handleNotificationRead = useCallback((payload: unknown) => {
        const data = payload as NotificationReadPayload | undefined
        if (data?.notificationId) {
            readIdsRef.current.add(data.notificationId)
            createdDuringRefreshRef.current = createdDuringRefreshRef.current.map(item =>
                item.id === data.notificationId ? { ...item, read: true } : item,
            )
            setNotifications(current => current.map(item => (item.id === data.notificationId ? { ...item, read: true } : item)))
        }
        if (typeof data?.unreadCount === 'number') {
            unreadVersionRef.current += 1
            setNotificationsUnreadCount(data.unreadCount)
        }
    }, [])

    const handleNotificationsReadAll = useCallback((payload: unknown) => {
        const data = payload as NotificationsReadAllPayload | undefined
        readAllVersionRef.current += 1
        createdDuringRefreshRef.current = createdDuringRefreshRef.current.map(item => ({ ...item, read: true }))
        setNotifications(current => current.map(item => ({ ...item, read: true })))
        if (typeof data?.unreadCount === 'number') {
            unreadVersionRef.current += 1
            setNotificationsUnreadCount(data.unreadCount)
        }
    }, [])

    useEffect(() => {
        resetNotifications()
        if (userId === '-1') {
            return
        }

        void refreshNotifications()
        return () => {
            generationRef.current += 1
        }
    }, [refreshNotifications, resetNotifications, userId])

    const notificationsValue = useMemo<NotificationsContextValue>(
        () => ({
            loading: notificationsLoading,
            loadingMore,
            loadMoreError,
            hasMore: nextCursor !== null,
            loadMore: loadMoreNotifications,
            notifications,
            unreadCount: notificationsUnreadCount,
            refresh: refreshNotifications,
            markRead: markNotificationRead,
            markAllRead: markAllNotificationsRead,
        }),
        [
            loadMoreError,
            loadMoreNotifications,
            loadingMore,
            nextCursor,
            markAllNotificationsRead,
            markNotificationRead,
            notifications,
            notificationsLoading,
            notificationsUnreadCount,
            refreshNotifications,
        ],
    )

    return {
        notificationsValue,
        handleNotificationCreated,
        handleNotificationRead,
        handleNotificationsReadAll,
    }
}
