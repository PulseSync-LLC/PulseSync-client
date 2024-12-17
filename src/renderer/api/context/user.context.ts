import { createContext } from 'react'
import UserInterface from '../interfaces/user.interface'
import userInitials from '../initials/user.initials'
import { Socket } from 'socket.io-client'
import SettingsInterface from '../interfaces/settings.interface'
import settingsInitials from '../initials/settings.initials'
import { AppInfoInterface } from '../interfaces/appinfo.interface'
import AppinfoInitials from '../initials/appinfo.initials'
import ThemeInterface from '../interfaces/theme.interface'
import themeInitials from '../initials/theme.initials'
import { ModInterface } from '../interfaces/modInterface'
import modInitials from '../initials/mod.initials'

interface p {
    user: UserInterface
    setUser: (userData: any) => void
    authorize?: () => void
    loading: boolean
    socket: Socket | null
    socketConnected: boolean
    app: SettingsInterface
    setApp: (settingsData: any) => void
    setUpdate: (state: boolean) => void
    themes: ThemeInterface[]
    setThemes: (themes: any) => void
    updateAvailable?: boolean
    appInfo: AppInfoInterface[]
    modInfo: ModInterface[]
    setMod: (mod: any) => void
}

const UserContext = createContext<p>({
    user: userInitials,
    setUser: () => void 0,
    authorize: () => void 0,
    loading: true,
    socket: null,
    socketConnected: false,
    app: settingsInitials,
    setApp: () => void 0,
    themes: themeInitials,
    setThemes: () => void 0,
    setUpdate: () => void 0,
    updateAvailable: false,
    appInfo: AppinfoInitials,
    modInfo: modInitials,
    setMod: () => void 0,
})

export default UserContext
