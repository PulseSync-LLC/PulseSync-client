import type { Dispatch, SetStateAction } from 'react'
import type { Socket } from 'socket.io-client'
import type UserInterface from '@entities/user/model/user.interface'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'
import type Addon from '@entities/addon/model/addon.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type { OutgoingGatewayEvent } from '@shared/api/socket/enums/outgoingGatewayEvents'

export type SettingsUpdater = SettingsInterface | ((prev: SettingsInterface) => SettingsInterface)
export type EmitGateway = (event: OutgoingGatewayEvent, payload: unknown) => void

export type UserContextValue = {
    user: UserInterface
    setUser: Dispatch<SetStateAction<UserInterface>>
    authorize: () => Promise<void>
    loading: boolean
    musicInstalled: boolean
    setMusicInstalled: Dispatch<SetStateAction<boolean>>
    musicVersion: string | null
    setMusicVersion: Dispatch<SetStateAction<string | null>>
    widgetInstalled: boolean
    setWidgetInstalled: Dispatch<SetStateAction<boolean>>
    socket: Socket | null
    socketConnected: boolean
    app: SettingsInterface
    setApp: Dispatch<SetStateAction<SettingsInterface>>
    isAppDeprecated: boolean
    setIsAppDeprecated: Dispatch<SetStateAction<boolean>>
    setUpdate: Dispatch<SetStateAction<boolean>>
    addons: Addon[]
    setAddons: Dispatch<SetStateAction<Addon[]>>
    updateAvailable: boolean
    appInfo: AppInfoInterface[]
    modInfo: ModInterface[]
    modInfoFetched: boolean
    setMod: Dispatch<SetStateAction<ModInterface[]>>
    features: Record<string, boolean>
    setFeatures: Dispatch<SetStateAction<Record<string, boolean>>>
    allAchievements: any[]
    setAllAchievements: Dispatch<SetStateAction<any[]>>
    emitGateway: EmitGateway
}
