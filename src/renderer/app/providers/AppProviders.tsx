import { lazy, useContext, useEffect, useMemo, useState } from 'react'

import { CssVarsProvider } from '@mui/joy'
import { RouterProvider } from 'react-router/dom'

import { CLIENT_EXPERIMENTS, ExperimentsProvider, useExperiments } from '@app/providers/experiments'
import LegacyAddonRestrictionsController from '@app/providers/experiments/LegacyAddonRestrictionsController'
import ListeningProvider from '@app/providers/ListeningProvider'
import { useModalContext } from '@app/providers/modal'
import { NewsProvider } from '@app/providers/news'
import { NotificationsProvider } from '@app/providers/notifications'
import PlayerProvider from '@app/providers/PlayerProvider'
import { useSocketContext } from '@app/providers/socket'
import UpdateChannelOverrideModal from '@widgets/modalContainer/modals/UpdateChannelOverrideModal'
import Preloader from '@widgets/preloader'
import { useCloudSettings } from '@features/settings/model/useCloudSettings'
import UserContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'
import DeferredContent from '@shared/ui/DeferredContent'

import type { AppProvidersProps } from '@app/AppShell.types'
import type { UserContextValue } from '@entities/user/model/context/types'

const SettingsModal = lazy(() => import('@widgets/modalContainer/modals/SettingsModal'))
const ExtensionPublicationModal = lazy(() => import('@widgets/modalContainer/modals/ExtensionPublicationModal'))

function BackgroundPreferencesBridge() {
    const { user, loading: appLoading, isModUpdating, addons } = useContext(UserContext)
    const { loading, isExperimentEnabled, localOverrides } = useExperiments()
    const { Modals, isModalOpen } = useModalContext()
    const [route, setRoute] = useState(() => window.location.hash.slice(1).split('?')[0])
    const [hasDraftOrDialog, setHasDraftOrDialog] = useState(false)
    const modalOpen = Object.values(Modals).some(modal => isModalOpen(modal))
    const trackSendingEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientTrackSending, false)
    const metricsSendingEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientMetricsSending, false)
    const listeningEnabled = user.id !== '-1' && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientListenTogether, false)
    const legacyAddonRestrictionsEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions, false)
    const legacyAddonRestrictionsOverrideGroup = localOverrides[CLIENT_EXPERIMENTS.ClientLegacyAddonRestrictions]?.group

    useEffect(() => {
        const inspect = () => {
            const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
            const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
            const draft = [...fields].some(
                field => !['hidden', 'checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(field.type) && field.value.trim() !== '',
            )
            setHasDraftOrDialog(!!dialog || draft)
        }
        inspect()
        const relevantSelector = 'input, textarea, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
        const containsRelevantElement = (node: Node) =>
            node instanceof Element && (node.matches(relevantSelector) || node.querySelector(relevantSelector) !== null)
        const observer = new MutationObserver(records => {
            if (
                records.some(
                    record =>
                        record.type === 'attributes' ||
                        (record.target instanceof Element && record.target.matches(relevantSelector)) ||
                        [...record.addedNodes, ...record.removedNodes].some(containsRelevantElement),
                )
            )
                inspect()
        })
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['role', 'aria-modal', 'type', 'value'],
        })
        document.addEventListener('input', inspect)
        document.addEventListener('change', inspect)
        return () => {
            observer.disconnect()
            document.removeEventListener('input', inspect)
            document.removeEventListener('change', inspect)
        }
    }, [])

    useEffect(() => {
        const changed = () => setRoute(window.location.hash.slice(1).split('?')[0])
        window.addEventListener('hashchange', changed)
        return () => window.removeEventListener('hashchange', changed)
    }, [])

    useEffect(() => {
        if (!desktopApi.background || loading || appLoading) return
        void desktopApi.background
            .setPreferences({
                userId: user.id,
                trackSendingEnabled,
                metricsSendingEnabled,
                listeningEnabled,
                legacyAddonRestrictionsEnabled,
                legacyAddonRestrictionsOverrideGroup,
                suspendAllowed: !isModUpdating && !modalOpen && !hasDraftOrDialog && ['/home', '/users', '/store', '/joint'].includes(route),
            })
            .catch(error => console.error('Could not configure background tasks:', error))
    }, [
        loading,
        appLoading,
        user.id,
        isModUpdating,
        modalOpen,
        hasDraftOrDialog,
        route,
        trackSendingEnabled,
        metricsSendingEnabled,
        listeningEnabled,
        legacyAddonRestrictionsEnabled,
        legacyAddonRestrictionsOverrideGroup,
        addons,
    ])
    return null
}

function DeferredSettingsModal({ onNavigate }: { onNavigate: (path: string) => void }) {
    const { Modals, isModalOpen } = useModalContext()
    const isOpen = isModalOpen(Modals.SETTINGS)
    return (
        <DeferredContent active={isOpen}>
            <SettingsModal onNavigate={onNavigate} />
        </DeferredContent>
    )
}

function DeferredPublicationModal() {
    const { Modals, isModalOpen } = useModalContext()
    return (
        <DeferredContent active={isModalOpen(Modals.EXTENSION_PUBLICATION_MODAL)}>
            <ExtensionPublicationModal />
        </DeferredContent>
    )
}

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
    preparedModUpdate,
    isModUpdating,
    achievementCatalogRevision,
    checkModUpdates,
    refreshAddons,
    notificationsValue,
    router,
    onLegacyAddonRestrictionsChange,
}: AppProvidersProps) {
    const { socketConnected, emitGateway } = useSocketContext()
    const cloudSettings = useCloudSettings(user.id, !loading && !isAutonomousMode, setApp, setAddons)

    useEffect(() => {
        const showDevFrame = app.info.devmark && app.settings.showDevFrame
        document.body.classList.toggle('devmark-border', showDevFrame)

        return () => {
            document.body.classList.remove('devmark-border')
        }
    }, [app.info.devmark, app.settings.showDevFrame])

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
            socketConnected,
            app,
            setApp,
            cloudSettings,
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
            preparedModUpdate,
            isModUpdating,
            achievementCatalogRevision,
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
            achievementCatalogRevision,
            modInfo,
            modInfoFetched,
            preparedModUpdate,
            isModUpdating,
            musicInstalled,
            musicVersion,
            refreshAddons,
            setApp,
            cloudSettings,
            setIsAppDeprecated,
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
                <DeferredPublicationModal />
                <NewsProvider key={user.id} enabled={!loading}>
                    <ExperimentsProvider userId={user.id} userPerm={user.perms} enabled={!loading}>
                        <BackgroundPreferencesBridge />
                        <ListeningProvider>
                            <LegacyAddonRestrictionsController addons={addons} onChange={onLegacyAddonRestrictionsChange} user={user} />
                            <DeferredSettingsModal onNavigate={path => void router.navigate(path)} />
                            <UpdateChannelOverrideModal />
                            <NotificationsProvider value={notificationsValue}>
                                <PlayerProvider>
                                    <CssVarsProvider>{loading ? <Preloader /> : <RouterProvider router={router} />}</CssVarsProvider>
                                </PlayerProvider>
                            </NotificationsProvider>
                        </ListeningProvider>
                    </ExperimentsProvider>
                </NewsProvider>
            </UserContext.Provider>
        </div>
    )
}
