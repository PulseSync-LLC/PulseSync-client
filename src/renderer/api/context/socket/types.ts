import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { Socket } from 'socket.io-client'
import type UserInterface from '../../interfaces/user.interface'
import type { OutgoingGatewayEvent } from '../../socket/enums/outgoingGatewayEvents'

export type EmitGateway = (event: OutgoingGatewayEvent, payload: unknown) => void

export type SocketContextValue = {
    socket: Socket | null
    socketConnected: boolean
    emitGateway: EmitGateway
}

export type SocketProviderProps = {
    userId: string
    appVersion: string
    setUser: Dispatch<SetStateAction<UserInterface>>
    setFeatures: Dispatch<SetStateAction<Record<string, boolean>>>
    setLoading: Dispatch<SetStateAction<boolean>>
    onLogout: () => Promise<void>
    onAchievementsUpdate?: (payload: unknown) => Promise<void> | void
    children: ReactNode
}
