import type UserInterface from '@entities/user/model/user.interface'
import type { OutgoingGatewayEvent } from '@shared/api/socket/enums/outgoingGatewayEvents'
import type { Dispatch, ReactNode, SetStateAction } from 'react'

export type EmitGateway = (event: OutgoingGatewayEvent, payload: unknown) => void

export type SocketContextValue = {
    socketConnected: boolean
    emitGateway: EmitGateway
}

export type SocketProviderProps = {
    userId: string
    appVersion: string
    setUser: Dispatch<SetStateAction<UserInterface>>
    onLogout: () => Promise<void>
    onAchievementsUpdate?: (payload: unknown) => Promise<void> | void
    onAddonStoreUpdated?: (payload: unknown) => Promise<void> | void
    onLocalAddonsChanged?: () => Promise<void> | void
    onNotificationCreated?: (payload: unknown) => Promise<void> | void
    onNotificationRead?: (payload: unknown) => Promise<void> | void
    onNotificationsReadAll?: (payload: unknown) => Promise<void> | void
    children: ReactNode
}
