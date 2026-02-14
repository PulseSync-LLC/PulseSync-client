import { createContext } from 'react'
import userInitials from '../../initials/user.initials'
import settingsInitials from '../../initials/settings.initials'
import AppinfoInitials from '../../initials/appinfo.initials'
import AddonInitials from '../../initials/addon.initials'
import modInitials from '../../initials/mod.initials'
import type { UserContextValue } from './types'
import type { OutgoingGatewayEvent } from '../../socket/enums/outgoingGatewayEvents'

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
    emitGateway: (_event: OutgoingGatewayEvent, _payload: unknown) => void 0,
}

const UserContext = createContext<UserContextValue>(defaultUserContextValue)

export default UserContext
