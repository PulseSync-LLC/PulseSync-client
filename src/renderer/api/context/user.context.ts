import { createContext } from 'react'
import UserInterface from '../interfaces/user.interface'
import userInitials from '../initials/user.initials'
import { Socket } from 'socket.io-client'
import SettingsInterface from '../interfaces/settings.interface'
import settingsInitials from '../initials/settings.initials'
import { AppInfoInterface } from '../interfaces/appinfo.interface'
import AppinfoInitials from '../initials/appinfo.initials'
import Addon from '../interfaces/addon.interface'
import AddonInitials from '../initials/addon.initials'
import { ModInterface } from '../interfaces/modInterface'
import modInitials from '../initials/mod.initials'

interface p {
    user: UserInterface
    setUser: (userData: any) => void
    authorize?: () => void
    loading: boolean
    musicInstalled: boolean
    setMusicInstalled: (value: boolean) => void
    musicVersion: string | null
    widgetInstalled?: boolean
    setWidgetInstalled?: (value: boolean) => void
    setMusicVersion: (version: string | null) => void
    socket: Socket | null
    socketConnected: boolean
    app: SettingsInterface
    setApp: (settingsData: any) => void
    setUpdate: (state: boolean) => void
    addons: Addon[]
    setAddons: (themes: any) => void
    updateAvailable?: boolean
    appInfo: AppInfoInterface[]
    modInfo: ModInterface[]
    setMod: (mod: any) => void
    features: Record<string, boolean>
    setFeatures: (features: Record<string, boolean>) => void
}

const UserContext = createContext<p>({
    user: userInitials,
    setUser: () => void 0,
    authorize: () => void 0,
    loading: true,
    musicInstalled: false,
    setMusicInstalled: () => void 0,
    musicVersion: null,
    setMusicVersion: () => void 0,
    widgetInstalled: false,
    setWidgetInstalled: () => void 0,
    socket: null,
    socketConnected: false,
    app: settingsInitials,
    setApp: () => void 0,
    addons: AddonInitials,
    setAddons: () => void 0,
    setUpdate: () => void 0,
    updateAvailable: false,
    appInfo: AppinfoInitials,
    modInfo: modInitials,
    setMod: () => void 0,
    features: {},
    setFeatures: () => void 0,
})

export default UserContext
