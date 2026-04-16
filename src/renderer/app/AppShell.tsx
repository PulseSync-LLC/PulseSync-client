import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import UserInterface from '@entities/user/model/user.interface'
import userInitials from '@entities/user/model/user.initials'
import { useNotificationsController } from '@app/providers/notifications/useNotificationsController'
import { SocketProvider } from '@app/providers/socket'
import toast from '@shared/ui/toast'
import 'react-loading-skeleton/dist/skeleton.css'
import apolloClient from '@shared/api/apolloClient'
import client from '@shared/api/apolloClient'
import SettingsInterface from '@entities/settings/model/settings.interface'
import settingsInitials from '@entities/settings/model/settings.initials'
import { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'

import { compareVersions } from '@shared/lib/utils'
import { usePextDnDImport } from '@shared/lib/usePextDnDImport'
import Addon from '@entities/addon/model/addon.interface'
import AddonInitials from '@entities/addon/model/addon.initials'
import { fetchStoreAddonUpdates } from '@entities/addon/api/storeAddons'
import { ModInterface } from '@entities/mod/model/modInterface'
import modInitials from '@entities/mod/model/mod.initials'
import GetModQuery from '@entities/mod/api/getMod.query'
import GetAchievementsQuery from '@entities/user/api/getAchievements.query'
import { useTranslation } from 'react-i18next'
import { createAppRouter } from '@app/router'
import AppProviders from '@app/providers/AppProviders'
import { useRendererErrorLogging } from '@app/model/useRendererErrorLogging'
import { useAppAuthorization } from '@app/model/useAppAuthorization'
import { useAppInitialization } from '@app/model/useAppInitialization'
import { useAppDesktopBindings } from '@app/model/useAppDesktopBindings'

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

function App() {
    const { t } = useTranslation()
    const tRef = useRef(t)
    const [updateAvailable, setUpdate] = useState(false)
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [app, setApp] = useState<SettingsInterface>(settingsInitials)
    const [modInfo, setMod] = useState<ModInterface[]>(modInitials)
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
    const toastReference = useRef<string | null>(null)
    const lastNotInstalledToastKeyRef = useRef<string | null>(null)
    const storeAddonUpdateCheckInFlightRef = useRef(false)
    const autoUpdatingStoreAddonIdsRef = useRef<Set<string>>(new Set())

    const [appInfo, setAppInfo] = useState<AppInfoInterface[]>([])
    const appRef = useRef(app)

    useEffect(() => {
        tRef.current = t
    }, [t])

    useRendererErrorLogging()

    useEffect(() => {
        appRef.current = app
    }, [app])

    const { notificationsValue, handleNotificationCreated, handleNotificationRead, handleNotificationsReadAll } = useNotificationsController(user.id)

    const router = useMemo(() => createAppRouter(), [])
    const { authorize, meLoading, setHasToken, setTokenReady } = useAppAuthorization({
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
        try {
            const res = await apolloClient.query<{ getMod: ModInterface[] }>({
                query: GetModQuery,
                fetchPolicy: 'no-cache',
            })

            const mods = res.data?.getMod
            if (!mods || mods.length === 0) {
                console.error('Invalid response format for getMod:', res.data)
                return
            }

            setMod(mods)

            const latest = mods[0]
            if (!app.mod.installed || !app.mod.version) {
                const toastKey = `not-installed:${latest.modVersion}`
                if (!silentNotInstalled && lastNotInstalledToastKeyRef.current !== toastKey) {
                    lastNotInstalledToastKeyRef.current = toastKey
                    toast.custom('info', tRef.current('mod.notInstalledTitle'), tRef.current('mod.availableVersion', { version: latest.modVersion }))
                }
                return
            }

            lastNotInstalledToastKeyRef.current = null
            if (compareVersions(latest.modVersion, app.mod.version) > 0) {
                const lastNotifiedModVersion = localStorage.getItem('lastNotifiedModVersion')
                if (lastNotifiedModVersion !== latest.modVersion) {
                    window.desktopEvents?.send(MainEvents.SHOW_NOTIFICATION, {
                        title: tRef.current('mod.updateAvailableTitle'),
                        body: tRef.current('mod.updateAvailableBody', { version: latest.modVersion }),
                    })
                    localStorage.setItem('lastNotifiedModVersion', latest.modVersion)
                }
            } else if (isManualCheck) {
                toast.custom('info', tRef.current('updates.mod.notFoundTitle'), tRef.current('updates.mod.notFoundMessage'))
            }
        } catch (modFetchError) {
            console.error('Failed to fetch mod info:', modFetchError)
            toast.custom('error', tRef.current('common.errorTitle'), tRef.current('common.somethingWrongTitle'))
        } finally {
            setModInfoFetched(true)
        }
    }, [])

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

    const syncStoreAddonUpdates = useCallback(async (installedAddons: Addon[]) => {
        const storeInstalledAddons = installedAddons.filter(addon => addon.installSource === 'store' && addon.storeAddonId)
        if (!storeInstalledAddons.length || !window.desktopEvents || storeAddonUpdateCheckInFlightRef.current) {
            return
        }

        storeAddonUpdateCheckInFlightRef.current = true

        try {
            const updates = await fetchStoreAddonUpdates(storeInstalledAddons.map(addon => addon.storeAddonId || ''))
            const installedByStoreId = new Map(storeInstalledAddons.map(addon => [addon.storeAddonId!, addon]))
            const outdatedAddons = updates.filter(publishedAddon => {
                const installedAddon = installedByStoreId.get(publishedAddon.id)
                return (
                    !!installedAddon &&
                    !!publishedAddon.currentRelease?.downloadUrl &&
                    compareVersions(publishedAddon.currentRelease.version, installedAddon.version) > 0
                )
            })

            if (!outdatedAddons.length) {
                return
            }

            const canAutoUpdate = appRef.current.settings.autoUpdateStoreAddons !== false
            const musicRunning = canAutoUpdate
                ? Boolean(await window.desktopEvents.invoke(MainEvents.GET_MUSIC_RUNNING_STATUS))
                : true

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
                        const result = await window.desktopEvents.invoke(MainEvents.INSTALL_STORE_ADDON, {
                            id: publishedAddon.id,
                            downloadUrl: release.downloadUrl,
                            title: publishedAddon.name,
                        })

                        if (!result?.success) {
                            throw new Error(result?.reason || 'STORE_ADDON_AUTO_UPDATE_FAILED')
                        }

                        const title = tRef.current('common.doneTitle')
                        const body = tRef.current('extensions.storeUpdateComplete', { name: publishedAddon.name })
                        window.desktopEvents.send(MainEvents.SHOW_NOTIFICATION, { title, body })
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

                window.desktopEvents.send(MainEvents.SHOW_NOTIFICATION, { title, body })
                toast.custom('info', title, body)
                localStorage.setItem(notificationKey, release.version)
            }

            if (hasInstalledUpdates) {
                const nextInstalledAddons = await window.desktopEvents.invoke(MainEvents.GET_ADDONS)
                setAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
            }
        } catch (error) {
            console.error('Failed to check store addon updates:', error)
        } finally {
            storeAddonUpdateCheckInFlightRef.current = false
        }
    }, [setAddons])

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
        if (!addons.length) {
            return
        }

        await syncStoreAddonUpdates(addons)
    }, [addons, syncStoreAddonUpdates])

    useEffect(() => {
        if (!addons.length) return
        void syncStoreAddonUpdates(addons)
    }, [addons, syncStoreAddonUpdates])

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
        setAppInfo,
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
        setApp,
        setHasToken,
        setNavigateState,
        setNavigateTo,
        setTokenReady,
        setUpdate,
        t,
        toastReference,
    })

    const handleSocketLogout = useCallback(async () => {
        await client.clearStore()
        setUser(userInitials)
        setAllAchievements([])
        await router.navigate('/auth', { replace: true })
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
                allAchievements={allAchievements}
                setAllAchievements={setAllAchievements}
                notificationsValue={notificationsValue}
                router={router}
            />
        </SocketProvider>
    )
}

export default App
