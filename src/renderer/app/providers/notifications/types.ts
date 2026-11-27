import type { NotificationItem } from '@common/notificationPresentation'
import type { ReactNode } from 'react'
export type { NotificationCategory, NotificationItem } from '@common/notificationPresentation'

export type NotificationsContextValue = {
    hasMore: boolean
    loadingMore: boolean
    loadMoreError: boolean
    loadMore: () => Promise<void>
    loading: boolean
    notifications: NotificationItem[]
    unreadCount: number
    refresh: () => Promise<void>
    setHistoryOpen: (open: boolean) => void
    markRead: (id: string) => Promise<void>
    markAllRead: () => Promise<void>
}

export type NotificationsProviderProps = {
    children: ReactNode
    value: NotificationsContextValue
}
