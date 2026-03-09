import type { Dispatch, SetStateAction } from 'react'
import type { Socket } from 'socket.io-client'
import type UserInterface from '../../interfaces/user.interface'
import type SettingsInterface from '../../interfaces/settings.interface'
import type { AppInfoInterface } from '../../interfaces/appinfo.interface'
import type Addon from '../../interfaces/addon.interface'
import type { ModInterface } from '../../interfaces/modInterface'
import type { OutgoingGatewayEvent } from '../../socket/enums/outgoingGatewayEvents'

export type SettingsUpdater = SettingsInterface | ((prev: SettingsInterface) => SettingsInterface)
export type EmitGateway = (event: OutgoingGatewayEvent, payload: unknown) => void

export type UserContextValue = {
    user: UserInterface
    setUser: Dispatch<SetStateAction<UserInterface>>
    authorize: () => Promise<void>
    loading: boolean
    musicInstalled: boolean
    setMusicInstalled: (value: boolean) => void
    musicVersion: string | null
    setMusicVersion: (version: string | null) => void
    widgetInstalled: boolean
    setWidgetInstalled: (value: boolean) => void
    socket: Socket | null
    socketConnected: boolean
    app: SettingsInterface
    setApp: (settingsData: any) => void
    isAppDeprecated: boolean
    setIsAppDeprecated: (value: boolean) => void
    setUpdate: (state: boolean) => void
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
