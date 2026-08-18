import React, { useCallback, useEffect, useMemo } from 'react'

import { CssVarsProvider } from '@mui/joy'
import { SkeletonTheme } from 'react-loading-skeleton'
import { RouterProvider } from 'react-router'

import { ExperimentsProvider } from '@app/providers/experiments'
import LegacyAddonRestrictionsController from '@app/providers/experiments/LegacyAddonRestrictionsController'
import { NewsProvider } from '@app/providers/news'
import { NotificationsProvider } from '@app/providers/notifications'
import PlayerProvider from '@app/providers/PlayerProvider'
import { useSocketContext } from '@app/providers/socket'
import SettingsModal from '@widgets/modalContainer/modals/SettingsModal'
import UpdateChannelOverrideModal from '@widgets/modalContainer/modals/UpdateChannelOverrideModal'
import Preloader from '@widgets/preloader'
import UserContext from '@entities/user/model/context'
import OutgoingGatewayEvents from '@shared/api/socket/enums/outgoingGatewayEvents'

import type { AppProvidersProps } from '@app/AppShell.types'
import type { SettingsUpdater, UserContextValue } from '@entities/user/model/context/types'

export default function AppProviders({
    user,
    setUser,
    isAutonomousMode,
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
    checkModUpdates,
    refreshAddons,
    notificationsValue,
    router,
    onLegacyAddonRestrictionsChange,
}: AppProvidersProps) {
    const { socket, socketConnected, emitGateway } = useSocketContext()

    useEffect(() => {
        const showDevFrame = app.info.devmark && app.settings.showDevFrame
        document.body.classList.toggle('devmark-border', showDevFrame)

        return () => {
            document.body.classList.remove('devmark-border')
        }
    }, [app.info.devmark, app.settings.showDevFrame])

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
            isAutonomousMode,
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
            checkModUpdates,
            refreshAddons,
            emitGateway,
        }),
        [
            addons,
            app,
            appInfo,
            authorize,
            checkModUpdates,
            emitGateway,
            isAppDeprecated,
            loading,
            allAchievements,
            modInfo,
            modInfoFetched,
            musicInstalled,
            musicVersion,
            refreshAddons,
            setAppWithSocket,
            setAllAchievements,
            setIsAppDeprecated,
            socket,
            socketConnected,
            updateAvailable,
            user,
            isAutonomousMode,
            widgetInstalled,
        ],
    )

    return (
        <div className="app-wrapper">
            <UserContext.Provider value={userContextValue}>
                <NewsProvider key={user.id} enabled={!loading}>
                    <ExperimentsProvider userId={user.id}>
                        <LegacyAddonRestrictionsController addons={addons} onChange={onLegacyAddonRestrictionsChange} user={user} />
                        <SettingsModal onNavigate={path => void router.navigate(path)} />
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
