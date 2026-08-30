import type { NotificationsContextValue } from '@app/providers/notifications/types'
import type { DesktopInstallModRequest } from '@common/desktopApi/contract'
import type Addon from '@entities/addon/model/addon.interface'
import type { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type UserInterface from '@entities/user/model/user.interface'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { createHashRouter } from 'react-router'

export type GetMeData = {
    getMe: Partial<UserInterface> | null
}

export type GetMeVars = Record<string, never>

export type LegacyAddonRestrictionsState = {
    enabled: boolean
    loading: boolean
}

export type AppProvidersProps = {
    user: UserInterface
    setUser: Dispatch<SetStateAction<UserInterface>>
    isAutonomousMode: boolean
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
    preparedModUpdate: DesktopInstallModRequest | null
    allAchievements: any[]
    setAllAchievements: Dispatch<SetStateAction<any[]>>
    checkModUpdates: (app: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => Promise<void>
    refreshAddons: () => Promise<void>
    notificationsValue: NotificationsContextValue
    router: ReturnType<typeof createHashRouter>
    onLegacyAddonRestrictionsChange: (state: LegacyAddonRestrictionsState) => void
}

export type PlayerProps = {
    children: ReactNode
}
