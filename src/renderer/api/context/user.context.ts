import { createContext } from 'react'
import UserInterface from '../interfaces/user.interface'
import userInitials from '../initials/user.initials'
import { Socket } from 'socket.io-client'
import SettingsInterface from '../interfaces/settings.interface'
import settingsInitials from '../initials/settings.initials'
import { AppInfoInterface } from '../interfaces/appinfo.interface'
import AppinfoInitials from '../initials/appinfo.initials'

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
    updateAvailable?: boolean
    appInfo: AppInfoInterface[]
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
    setUpdate: () => void 0,
    updateAvailable: false,
    appInfo: AppinfoInitials,
})

export default UserContext
