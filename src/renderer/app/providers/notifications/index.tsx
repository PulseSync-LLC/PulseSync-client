import React, { createContext, useContext } from 'react'
import type { NotificationsContextValue, NotificationsProviderProps } from '@app/providers/notifications/types'

const noop = async (): Promise<void> => undefined

const defaultNotificationsContextValue: NotificationsContextValue = {
    loading: false,
    notifications: [],
    unreadCount: 0,
    refresh: noop,
    markRead: noop,
    markAllRead: noop,
}

export const NotificationsContext = createContext<NotificationsContextValue>(defaultNotificationsContextValue)

export function NotificationsProvider({ children, value }: NotificationsProviderProps) {
    return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
    return useContext(NotificationsContext)
}
