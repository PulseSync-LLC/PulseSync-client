import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { normalizeSupportedLanguage, rememberLanguage } from '@app/i18n'
import { useAppAuthorization } from '@app/model/useAppAuthorization'
import { useAppDesktopBindings } from '@app/model/useAppDesktopBindings'
import { useAppInitialization } from '@app/model/useAppInitialization'
import { useRendererErrorLogging } from '@app/model/useRendererErrorLogging'
import AppProviders from '@app/providers/AppProviders'
import { useNotificationsController } from '@app/providers/notifications/useNotificationsController'
import { SocketProvider } from '@app/providers/socket'
import { createAppRouter } from '@app/router'
import { fetchStoreAddonUpdates } from '@entities/addon/api/storeAddons'
import { isRestrictedLegacyAddon } from '@entities/addon/lib/legacyAddonRestrictions'
import AddonInitials from '@entities/addon/model/addon.initials'
import { prepareModReleaseUpdate } from '@entities/mod/lib/installModRelease'
import { getModReleaseIdentity, isModReleaseUpdateAvailable } from '@entities/mod/lib/modReleaseUpdate'
import modInitials from '@entities/mod/model/mod.initials'
import settingsInitials from '@entities/settings/model/settings.initials'
import GetAchievementsQuery from '@entities/user/api/getAchievements.query'
import userInitials from '@entities/user/model/user.initials'
import apolloClient from '@shared/api/apolloClient'
import client from '@shared/api/apolloClient'
import { desktopApi } from '@shared/desktop/desktopApi'
import { usePextDnDImport } from '@shared/lib/usePextDnDImport'
import { compareVersions } from '@shared/lib/utils'
import toast from '@shared/ui/toast'

import 'react-loading-skeleton/dist/skeleton.css'

import type { LegacyAddonRestrictionsState } from '@app/AppShell.types'
import type { DesktopInstallModRequest } from '@common/desktopApi/contract'
import type Addon from '@entities/addon/model/addon.interface'
import type { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type UserInterface from '@entities/user/model/user.interface'

type AchievementCatalogItem = {
    id: string
    title: string
    description: string
    imageUrl: string
    progressTotal: number
    points: number
    difficulty: string
    hint: string
}

type GetAchievementsData = {
    getAchievements?: {
        achievements?: AchievementCatalogItem[]
        totalPages?: number
    } | null
}

type GetAchievementsVars = {
    page: number
    pageSize: number
    search?: string
    sortOptions?: Array<unknown>
}

const STORE_ADDON_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000
const MOD_UPDATE_TOAST_ID = 'mod-update-check'

function App() {
    const { i18n, t } = useTranslation()
    const tRef = useRef(t)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [modInfo, setMod] = useState<ModInterface[]>(modInitials)
    const [preparedModUpdate, setPreparedModUpdate] = useState<DesktopInstallModRequest | null>(null)
    const [addons, setAddons] = useState<Addon[]>(AddonInitials)
    const [allAchievements, setAllAchievements] = useState<AchievementCatalogItem[]>([])
    const [navigateTo, setNavigateTo] = useState<string | null>(null)
    const [navigateState, setNavigateState] = useState<Addon | null>(null)
    const [loading, setLoading] = useState(true)
    const [musicInstalled, setMusicInstalled] = useState(false)
    const [musicVersion, setMusicVersion] = useState<string | null>(null)
    const [modInfoFetched, setModInfoFetched] = useState(false)
    const [widgetInstalled, setWidgetInstalled] = useState(false)
    const [isAppDeprecated, setIsAppDeprecated] = useState(false)
    const [legacyAddonRestrictions, setLegacyAddonRestrictions] = useState<LegacyAddonRestrictionsState>({ enabled: false, loading: true })
    const toastReference = useRef<string | null>(null)
    const lastNotInstalledToastKeyRef = useRef<string | null>(null)
    const storeAddonUpdateCheckInFlightRef = useRef(false)
    const autoUpdatingStoreAddonIdsRef = useRef<Set<string>>(new Set())

    const [appInfo] = useState<AppInfoInterface[]>([])
    const appRef = useRef(app)
    const isAutonomousMode = user.id === '-1'

    useEffect(() => {
        tRef.current = t
    }, [t])

    useRendererErrorLogging()

    useEffect(() => {
        appRef.current = app
    }, [app])

    useEffect(() => {
        const language = normalizeSupportedLanguage(app.settings.language)
        rememberLanguage(language)
        if (i18n.language !== language) {
            void i18n.changeLanguage(language)
        }
    }, [app.settings.language, i18n])

    const { notificationsValue, handleNotificationCreated, handleNotificationRead, handleNotificationsReadAll } = useNotificationsController(user.id)

    const router = useMemo(() => createAppRouter(), [])
    const { authorize, setHasToken, setTokenReady } = useAppAuthorization({
        router,
        setIsAppDeprecated,
        setLoading,
        setUser,
        tRef,
        userId: user.id,
    })

    const fetchModInfo = useCallback(async (app: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => {
        const isManualCheck = !!options?.manual
        const silentNotInstalled = !!options?.silentNotInstalled
        const manualToastId = isManualCheck
            ? toast.custom('loading', tRef.current('updates.checkingTitle'), tRef.current('common.pleaseWait'), {
                  id: MOD_UPDATE_TOAST_ID,
                  duration: Infinity,
              })
            : null
        const updateManualToast = (kind: 'error' | 'info', title: string, msg: string) => {
            if (!manualToastId) return
            toast.update(manualToastId, { kind, title, msg, sticky: false, duration: 5000 })
        }

        try {
            const mods = (await desktopApi.mods.getReleases()) as ModInterface[] | undefined
            if (!mods) {
                console.error('Invalid response format for mod releases:', mods)
                updateManualToast('error', tRef.current('common.errorTitle'), tRef.current('common.somethingWrongTitle'))
                return
            }

            if (mods.length === 0) {
                updateManualToast('info', tRef.current('updates.mod.notFoundTitle'), tRef.current('updates.mod.notFoundMessage'))
                return
            }

            setMod(mods)

            const latest = mods[0]
            if (!app.mod.installed || !app.mod.version) {
                const toastKey = `not-installed:${latest.modVersion}`
                if (isManualCheck) {
                    lastNotInstalledToastKeyRef.current = toastKey
                    updateManualToast(
                        'info',
                        tRef.current('mod.notInstalledTitle'),
                        tRef.current('mod.availableVersion', { version: latest.modVersion }),
                    )
                } else if (!silentNotInstalled && lastNotInstalledToastKeyRef.current !== toastKey) {
                    lastNotInstalledToastKeyRef.current = toastKey
                    toast.custom('info', tRef.current('mod.notInstalledTitle'), tRef.current('mod.availableVersion', { version: latest.modVersion }))
                }
                return
            }

            lastNotInstalledToastKeyRef.current = null
            if (isModReleaseUpdateAvailable(latest, app.mod)) {
                prepareModReleaseUpdate(latest)
                updateManualToast(
                    'info',
                    tRef.current('mod.updateAvailableTitle'),
                    tRef.current('mod.updateAvailableBody', { version: latest.modVersion }),
                )
                const releaseIdentity = getModReleaseIdentity(latest)
                const lastNotifiedModVersion = localStorage.getItem('lastNotifiedModVersion')
                if (lastNotifiedModVersion !== releaseIdentity) {
                    desktopApi.system.showNotification({
                        title: tRef.current('mod.updateAvailableTitle'),
                        body: tRef.current('mod.updateAvailableBody', { version: latest.modVersion }),
                    })
                    localStorage.setItem('lastNotifiedModVersion', releaseIdentity)
                }
            } else {
                updateManualToast('info', tRef.current('updates.mod.notFoundTitle'), tRef.current('updates.mod.notFoundMessage'))
            }
        } catch (modFetchError) {
            console.error('Failed to fetch mod info:', modFetchError)
            if (isManualCheck) {
                updateManualToast('error', tRef.current('common.errorTitle'), tRef.current('common.somethingWrongTitle'))
            } else {
                toast.custom('error', tRef.current('common.errorTitle'), tRef.current('common.somethingWrongTitle'))
            }
        } finally {
            setModInfoFetched(true)
        }
    }, [])

    const refreshAddons = useCallback(async () => {
        const nextAddons = await desktopApi.addons.list()
        setAddons(Array.isArray(nextAddons) ? nextAddons : [])
        await router.navigate('/extensions', { replace: true })
    }, [router])

    const fetchAchievements = useCallback(async () => {
        try {
            const pageSize = 100
            const baseVars = {
                pageSize,
                search: '',
                sortOptions: [] as Array<unknown>,
            }

            const firstPage = await apolloClient.query<GetAchievementsData, GetAchievementsVars>({
                query: GetAchievementsQuery,
                variables: {
                    ...baseVars,
                    page: 1,
                },
                fetchPolicy: 'no-cache',
            })

            const firstAchievements = firstPage.data?.getAchievements?.achievements || []
            const totalPages = Math.max(1, Number(firstPage.data?.getAchievements?.totalPages || 1))

            if (totalPages <= 1) {
                setAllAchievements(firstAchievements)
                return
            }

            const pageRequests = Array.from({ length: totalPages - 1 }, (_, index) =>
                apolloClient.query<GetAchievementsData, GetAchievementsVars>({
                    query: GetAchievementsQuery,
                    variables: {
                        ...baseVars,
                        page: index + 2,
                    },
                    fetchPolicy: 'no-cache',
                }),
            )

            const otherPages = await Promise.all(pageRequests)
            const merged = [...firstAchievements, ...otherPages.flatMap(page => page.data?.getAchievements?.achievements || [])]
            const unique = Array.from(new Map(merged.map(item => [item.id, item])).values())
            setAllAchievements(unique)
        } catch (achievementsError) {
            console.error('Failed to fetch achievements:', achievementsError)
        }
    }, [])

    const syncStoreAddonUpdates = useCallback(
        async (installedAddons: Addon[]) => {
            if (isAutonomousMode || legacyAddonRestrictions.loading) {
                return
            }

            const storeInstalledAddons = installedAddons.filter(addon => addon.installSource === 'store' && addon.storeAddonId)
            if (!storeInstalledAddons.length || storeAddonUpdateCheckInFlightRef.current) {
                return
            }

            storeAddonUpdateCheckInFlightRef.current = true

            try {
                const updates = await fetchStoreAddonUpdates(storeInstalledAddons.map(addon => addon.storeAddonId || ''))
                const installedByStoreId = new Map(storeInstalledAddons.map(addon => [addon.storeAddonId!, addon]))
                const outdatedAddons = updates.filter(publishedAddon => {
                    const installedAddon = installedByStoreId.get(publishedAddon.id)
                    const legacyUpdateBlocked =
                        isRestrictedLegacyAddon(installedAddon, legacyAddonRestrictions.enabled) && publishedAddon.type === 'script'
                    return (
                        !!installedAddon &&
                        !legacyUpdateBlocked &&
                        !!publishedAddon.currentRelease?.downloadUrl &&
                        compareVersions(publishedAddon.currentRelease.version, installedAddon.version) > 0
                    )
                })

                if (!outdatedAddons.length) {
                    return
                }

                const canAutoUpdate = appRef.current.settings.autoUpdateStoreAddons !== false
                const musicRunning = canAutoUpdate ? Boolean(await desktopApi.music.getRunningStatus()) : true

                let hasInstalledUpdates = false

                for (const publishedAddon of outdatedAddons) {
                    const release = publishedAddon.currentRelease
                    const installedAddon = installedByStoreId.get(publishedAddon.id)
                    if (!release?.downloadUrl || !installedAddon) {
                        continue
                    }

                    const notificationKey = `lastNotifiedStoreAddonVersion:${publishedAddon.id}`

                    if (!musicRunning && canAutoUpdate) {
                        if (autoUpdatingStoreAddonIdsRef.current.has(publishedAddon.id)) {
                            continue
                        }

                        autoUpdatingStoreAddonIdsRef.current.add(publishedAddon.id)
                        try {
                            const result = (await desktopApi.addons.installStore({
                                id: publishedAddon.id,
                                downloadUrl: release.downloadUrl,
                                title: publishedAddon.name,
                            })) as { reason?: string; success?: boolean } | null | undefined

                            if (!result?.success) {
                                throw new Error(result?.reason || 'STORE_ADDON_AUTO_UPDATE_FAILED')
                            }

                            const title = tRef.current('common.doneTitle')
                            const body = tRef.current('extensions.storeUpdateComplete', { name: publishedAddon.name })
                            desktopApi.system.showNotification({ title, body })
                            toast.custom('success', title, body)
                            localStorage.setItem(notificationKey, release.version)
                            hasInstalledUpdates = true
                        } catch (error) {
                            console.error(`Failed to auto-update store addon "${publishedAddon.name}":`, error)
                        } finally {
                            autoUpdatingStoreAddonIdsRef.current.delete(publishedAddon.id)
                        }

                        continue
                    }

                    if (localStorage.getItem(notificationKey) === release.version) {
                        continue
                    }

                    const title = tRef.current('extensions.storeUpdateAvailableTitle')
                    const body = tRef.current('extensions.storeUpdateAvailableMessage', {
                        name: publishedAddon.name,
                        version: release.version,
                    })

                    desktopApi.system.showNotification({ title, body })
                    toast.custom('info', title, body)
                    localStorage.setItem(notificationKey, release.version)
                }

                if (hasInstalledUpdates) {
                    const nextInstalledAddons = await desktopApi.addons.list()
                    setAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
                }
            } catch (error) {
                console.error('Failed to check store addon updates:', error)
            } finally {
                storeAddonUpdateCheckInFlightRef.current = false
            }
        },
        [isAutonomousMode, legacyAddonRestrictions.enabled, legacyAddonRestrictions.loading, setAddons],
    )

    const handleSocketAchievementsUpdate = useCallback(
        async (payload: unknown) => {
            await fetchAchievements()

            if (!payload || typeof payload !== 'object') return

            const {
                userId: incomingUserId,
                userAchievements: incomingUserAchievements,
                levelInfoV2: incomingLevelInfo,
            } = payload as {
                userId?: string
                userAchievements?: unknown
                levelInfoV2?: unknown
            }

            if (!incomingUserId || !Array.isArray(incomingUserAchievements)) return

            setUser(prev => {
                if (prev.id !== incomingUserId) return prev
                return {
                    ...prev,
                    userAchievements: incomingUserAchievements,
                    levelInfoV2:
                        incomingLevelInfo && typeof incomingLevelInfo === 'object'
                            ? (incomingLevelInfo as UserInterface['levelInfoV2'])
                            : prev.levelInfoV2,
                }
            })
        },
        [fetchAchievements],
    )

    const handleSocketStoreAddonUpdated = useCallback(async () => {
        if (isAutonomousMode || !addons.length) {
            return
        }

        await syncStoreAddonUpdates(addons)
    }, [addons, isAutonomousMode, syncStoreAddonUpdates])

    useEffect(() => {
        if (isAutonomousMode || !addons.length) return
        void syncStoreAddonUpdates(addons)
    }, [addons, isAutonomousMode, syncStoreAddonUpdates])

    useEffect(() => {
        if (user.id === '-1') {
            return
        }

        const intervalId = window.setInterval(() => {
            if (addons.length) {
                void syncStoreAddonUpdates(addons)
            }
        }, STORE_ADDON_UPDATE_CHECK_INTERVAL_MS)

        return () => {
            window.clearInterval(intervalId)
        }
    }, [addons, syncStoreAddonUpdates, user.id])

    useAppInitialization({
        appRef,
        fetchAchievements,
        fetchModInfo,
        router,
        setAddons,
        setAllAchievements,
        setApp,
        setModInfoFetched,
        setMusicInstalled,
        setMusicVersion,
        setWidgetInstalled,
        userId: user.id,
    })

    usePextDnDImport()

    useEffect(() => {
        if (navigateTo && navigateState) {
            router.navigate(navigateTo, { state: { theme: navigateState } })
        }
    }, [navigateTo, navigateState, router])
    useAppDesktopBindings({
        appRef,
        authorize,
        fetchModInfo,
        router,
        setAddons,
        setHasToken,
        setNavigateState,
        setNavigateTo,
        setPreparedModUpdate,
        setTokenReady,
        setUpdate,
        t,
        toastReference,
    })

    const handleSocketLogout = useCallback(async () => {
        await client.clearStore()
        setUser(userInitials)
        setAllAchievements([])
        await router.navigate('/home', { replace: true })
    }, [router])

    return (
        <SocketProvider
            userId={user.id}
            appVersion={app.info.version}
            setUser={setUser}
            setLoading={setLoading}
            onLogout={handleSocketLogout}
            onAchievementsUpdate={handleSocketAchievementsUpdate}
            onAddonStoreUpdated={handleSocketStoreAddonUpdated}
            onNotificationCreated={handleNotificationCreated}
            onNotificationRead={handleNotificationRead}
            onNotificationsReadAll={handleNotificationsReadAll}
        >
            <AppProviders
                user={user}
                setUser={setUser}
                isAutonomousMode={isAutonomousMode}
                authorize={authorize}
                loading={loading}
                musicInstalled={musicInstalled}
                setMusicInstalled={setMusicInstalled}
                musicVersion={musicVersion}
                setMusicVersion={setMusicVersion}
                widgetInstalled={widgetInstalled}
                setWidgetInstalled={setWidgetInstalled}
                app={app}
                setApp={setApp}
                isAppDeprecated={isAppDeprecated}
                setIsAppDeprecated={setIsAppDeprecated}
                updateAvailable={updateAvailable}
                setUpdate={setUpdate}
                appInfo={appInfo}
                setAddons={setAddons}
                addons={addons}
                setMod={setMod}
                modInfo={modInfo}
                modInfoFetched={modInfoFetched}
                preparedModUpdate={preparedModUpdate}
                allAchievements={allAchievements}
                setAllAchievements={setAllAchievements}
                checkModUpdates={fetchModInfo}
                refreshAddons={refreshAddons}
                notificationsValue={notificationsValue}
                router={router}
                onLegacyAddonRestrictionsChange={setLegacyAddonRestrictions}
            />
        </SocketProvider>
    )
}

export default App
