import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { createHashRouter } from 'react-router'
import type UserInterface from '../api/interfaces/user.interface'
import type SettingsInterface from '../api/interfaces/settings.interface'
import type { AppInfoInterface } from '../api/interfaces/appinfo.interface'
import type Addon from '../api/interfaces/addon.interface'
import type { ModInterface } from '../api/interfaces/modInterface'

export type GetMeData = {
    getMe: Partial<UserInterface> | null
}

export type GetMeVars = Record<string, never>

export type AppProvidersProps = {
    user: UserInterface
    setUser: Dispatch<SetStateAction<UserInterface>>
    authorize: () => Promise<void>
    loading: boolean
    meLoading: boolean
    musicInstalled: boolean
    setMusicInstalled: (value: boolean) => void
    musicVersion: string | null
    setMusicVersion: (version: string | null) => void
    widgetInstalled: boolean
    setWidgetInstalled: (value: boolean) => void
    app: SettingsInterface
    setApp: Dispatch<SetStateAction<SettingsInterface>>
    isAppDeprecated: boolean
    setIsAppDeprecated: (value: boolean) => void
    updateAvailable: boolean
    setUpdate: (state: boolean) => void
    appInfo: AppInfoInterface[]
    setAddons: Dispatch<SetStateAction<Addon[]>>
    addons: Addon[]
    setMod: Dispatch<SetStateAction<ModInterface[]>>
    modInfo: ModInterface[]
    modInfoFetched: boolean
    features: Record<string, boolean>
    setFeatures: Dispatch<SetStateAction<Record<string, boolean>>>
    allAchievements: any[]
    setAllAchievements: Dispatch<SetStateAction<any[]>>
    router: ReturnType<typeof createHashRouter>
}

export type PlayerProps = {
    children: ReactNode
}
