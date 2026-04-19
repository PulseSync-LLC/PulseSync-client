import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { createHashRouter } from 'react-router'
import type UserInterface from '@entities/user/model/user.interface'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'
import type Addon from '@entities/addon/model/addon.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type { NotificationsContextValue } from '@app/providers/notifications/types'

export type GetMeData = {
    getMe: Partial<UserInterface> | null
}

export type GetMeVars = Record<string, never>

export type AppProvidersProps = {
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
    app: SettingsInterface
    setApp: Dispatch<SetStateAction<SettingsInterface>>
    isAppDeprecated: boolean
    setIsAppDeprecated: Dispatch<SetStateAction<boolean>>
    updateAvailable: boolean
    setUpdate: Dispatch<SetStateAction<boolean>>
    appInfo: AppInfoInterface[]
    setAddons: Dispatch<SetStateAction<Addon[]>>
    addons: Addon[]
    setMod: Dispatch<SetStateAction<ModInterface[]>>
    modInfo: ModInterface[]
    modInfoFetched: boolean
    allAchievements: any[]
    setAllAchievements: Dispatch<SetStateAction<any[]>>
    notificationsValue: NotificationsContextValue
    router: ReturnType<typeof createHashRouter>
}

export type PlayerProps = {
    children: ReactNode
}
