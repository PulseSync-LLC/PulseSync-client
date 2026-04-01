import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import MainEvents from '@common/types/mainEvents'
import config from '@common/appConfig'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type Addon from '@entities/addon/model/addon.interface'
import type { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'

type Params = {
    appRef: MutableRefObject<SettingsInterface>
    fetchAchievements: () => Promise<void>
    fetchModInfo: (app: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => Promise<void>
    router: { navigate: (to: string, options?: any) => Promise<void> | void }
    setAddons: Dispatch<SetStateAction<Addon[]>>
    setAllAchievements: Dispatch<SetStateAction<any[]>>
    setAppInfo: Dispatch<SetStateAction<AppInfoInterface[]>>
    setModInfoFetched: Dispatch<SetStateAction<boolean>>
    setMusicInstalled: Dispatch<SetStateAction<boolean>>
    setMusicVersion: Dispatch<SetStateAction<string | null>>
    setWidgetInstalled: Dispatch<SetStateAction<boolean>>
    userId: string
}

export function useAppInitialization({
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
    userId,
}: Params) {
    useEffect(() => {
        if (userId === '-1') {
            setModInfoFetched(false)
        }
    }, [setModInfoFetched, userId])

    useEffect(() => {
        if (userId !== '-1') {
            const initializeApp = async () => {
                window.desktopEvents?.send(MainEvents.UPDATER_START)
                window.desktopEvents?.send(MainEvents.CHECK_MUSIC_INSTALL)
                window.desktopEvents?.send(MainEvents.UI_READY)

                const [musicStatus, musicVersion, fetchedAddons] = await Promise.all([
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS),
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_VERSION),
                    window.desktopEvents?.invoke(MainEvents.GET_ADDONS),
                ])

                setMusicInstalled(!!musicStatus)
                setMusicVersion(musicVersion || null)
                setAddons((fetchedAddons as Addon[]) || [])

                try {
                    const widgetExists = await window.desktopEvents?.invoke(MainEvents.CHECK_OBS_WIDGET_INSTALLED)
                    setWidgetInstalled(widgetExists || false)
                } catch (error) {
                    console.error('Failed to check widget installation:', error)
                    setWidgetInstalled(false)
                }

                try {
                    const res = await fetch(`${config.SERVER_URL}/api/v1/app/info`)
                    const data = await res.json()
                    if (data.ok && Array.isArray(data.appInfo)) {
                        const sortedAppInfos = data.appInfo.sort((a: any, b: any) => b.id - a.id)
                        setAppInfo(sortedAppInfos)
                    }
                } catch (error) {
                    console.error('Failed to fetch app info:', error)
                }

                await Promise.all([fetchModInfo(appRef.current), fetchAchievements()])
            }

            void initializeApp()

            const modCheckId = setInterval(() => {
                void fetchModInfo(appRef.current)
            }, 10 * 60 * 1000)
            return () => {
                clearInterval(modCheckId)
            }
        }

        setAllAchievements([])
        router.navigate('/auth', { replace: true })
    }, [
        appRef,
        fetchAchievements,
        fetchModInfo,
        router,
        setAddons,
        setAllAchievements,
        setAppInfo,
        setMusicInstalled,
        setMusicVersion,
        setWidgetInstalled,
        userId,
    ])
}
