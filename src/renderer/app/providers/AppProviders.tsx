import React, { useCallback, useMemo } from 'react'
import { RouterProvider } from 'react-router'
import { Toaster } from 'react-hot-toast'
import { CssVarsProvider } from '@mui/joy'
import { SkeletonTheme } from 'react-loading-skeleton'

import UserContext from '@entities/user/model/context'
import type { SettingsUpdater, UserContextValue } from '@entities/user/model/context/types'
import { NotificationsProvider } from '@app/providers/notifications'
import { NewsProvider } from '@app/providers/news'
import { useSocketContext } from '@app/providers/socket'
import { ExperimentsProvider } from '@app/providers/experiments'
import OutgoingGatewayEvents from '@shared/api/socket/enums/outgoingGatewayEvents'
import Preloader from '@widgets/preloader'
import ExperimentOverridesDevModal from '@widgets/modalContainer/modals/ExperimentOverridesDevModal'
import UpdateChannelOverrideModal from '@widgets/modalContainer/modals/UpdateChannelOverrideModal'
import type { AppProvidersProps } from '@app/AppShell.types'
import PlayerProvider from '@app/providers/PlayerProvider'

export default function AppProviders({
    user,
    setUser,
    authorize,
    loading,
    musicInstalled,
    setMusicInstalled,
    musicVersion,
    setMusicVersion,
    widgetInstalled,
    setWidgetInstalled,
    app,
    setApp,
    isAppDeprecated,
    setIsAppDeprecated,
    updateAvailable,
    setUpdate,
    appInfo,
    setAddons,
    addons,
    setMod,
    modInfo,
    modInfoFetched,
    allAchievements,
    setAllAchievements,
    notificationsValue,
    router,
}: AppProvidersProps) {
    const { socket, socketConnected, emitGateway } = useSocketContext()

    const setAppWithSocket = useCallback(
        (updater: SettingsUpdater) => {
            setApp(prevSettings => {
                const updatedSettings = typeof updater === 'function' ? updater(prevSettings) : updater
                const { tokens: _tokens, info: _info, ...socketInfo } = updatedSettings
                emitGateway(OutgoingGatewayEvents.USER_SETTINGS_UPDATE, socketInfo)
                return updatedSettings
            })
        },
        [emitGateway, setApp],
    )

    const userContextValue = useMemo<UserContextValue>(
        () => ({
            user,
            setUser,
            authorize,
            loading,
            musicInstalled,
            setMusicInstalled,
            musicVersion,
            setMusicVersion,
            widgetInstalled,
            setWidgetInstalled,
            socket,
            socketConnected,
            app,
            setApp: setAppWithSocket,
            isAppDeprecated,
            setIsAppDeprecated,
            updateAvailable,
            setUpdate,
            appInfo,
            setAddons,
            addons,
            setMod,
            modInfo,
            modInfoFetched,
            allAchievements,
            setAllAchievements,
            emitGateway,
        }),
        [
            addons,
            app,
            appInfo,
            authorize,
            emitGateway,
            isAppDeprecated,
            loading,
            allAchievements,
            modInfo,
            modInfoFetched,
            musicInstalled,
            musicVersion,
            setAppWithSocket,
            setAllAchievements,
            setIsAppDeprecated,
            socket,
            socketConnected,
            updateAvailable,
            user,
            widgetInstalled,
        ],
    )

    return (
        <div className="app-wrapper">
            <Toaster
                position="top-center"
                reverseOrder={false}
                containerStyle={{
                    zIndex: 100050,
                }}
                toastOptions={{
                    style: {
                        zIndex: 100050,
                    },
                }}
            />
            <UserContext.Provider value={userContextValue}>
                <NewsProvider key={user.id} enabled={!loading}>
                    <ExperimentsProvider userId={user.id}>
                        <ExperimentOverridesDevModal />
                        <UpdateChannelOverrideModal />
                        <NotificationsProvider value={notificationsValue}>
                            <PlayerProvider>
                                <SkeletonTheme baseColor="#1c1c22" highlightColor="#333">
                                    <CssVarsProvider>{loading ? <Preloader /> : <RouterProvider router={router} />}</CssVarsProvider>
                                </SkeletonTheme>
                            </PlayerProvider>
                        </NotificationsProvider>
                    </ExperimentsProvider>
                </NewsProvider>
            </UserContext.Provider>
        </div>
    )
}
