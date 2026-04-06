import type { ReactNode } from 'react'

export type NotificationCategory = 'achievement' | 'localization' | 'subscription' | 'security' | 'system' | string

export type NotificationItem = {
    category: NotificationCategory
    createdAt: string | number
    id: string
    link: string | null
    payload: Record<string, unknown> | null
    read: boolean
    type: string
}

export type NotificationsContextValue = {
    loading: boolean
    notifications: NotificationItem[]
    unreadCount: number
    refresh: () => Promise<void>
    markRead: (id: string) => Promise<void>
    markAllRead: () => Promise<void>
}

export type NotificationsProviderProps = {
    children: ReactNode
    value: NotificationsContextValue
}
