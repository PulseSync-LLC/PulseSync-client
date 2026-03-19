import { createContext } from 'react'
import userInitials from '@entities/user/model/user.initials'
import settingsInitials from '@entities/settings/model/settings.initials'
import AppinfoInitials from '@entities/appInfo/model/appinfo.initials'
import AddonInitials from '@entities/addon/model/addon.initials'
import modInitials from '@entities/mod/model/mod.initials'
import type { UserContextValue } from '@entities/user/model/context/types'
import type { OutgoingGatewayEvent } from '@shared/api/socket/enums/outgoingGatewayEvents'

const noopAsync = async (): Promise<void> => {}

const defaultUserContextValue: UserContextValue = {
    user: userInitials,
    setUser: () => void 0,
    authorize: noopAsync,
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
    isAppDeprecated: false,
    setIsAppDeprecated: () => void 0,
    addons: AddonInitials,
    setAddons: () => void 0,
    setUpdate: () => void 0,
    updateAvailable: false,
    appInfo: AppinfoInitials,
    modInfo: modInitials,
    modInfoFetched: false,
    setMod: () => void 0,
    features: {},
    setFeatures: () => void 0,
    allAchievements: [],
    setAllAchievements: () => void 0,
    emitGateway: (_event: OutgoingGatewayEvent, _payload: unknown) => void 0,
}

const UserContext = createContext<UserContextValue>(defaultUserContextValue)

export default UserContext
