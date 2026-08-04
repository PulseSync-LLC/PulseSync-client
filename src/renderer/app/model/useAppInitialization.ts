import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import config from '@common/appConfig'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type Addon from '@entities/addon/model/addon.interface'
import { fetchSettings } from '@entities/settings/api/settings'
import { desktopApi } from '@shared/desktop/desktopApi'
type Params = {
    appRef: MutableRefObject<SettingsInterface>
    fetchAchievements: () => Promise<void>
    fetchModInfo: (app: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => Promise<void>
    router: {
        navigate: (to: string, options?: any) => Promise<void> | void
        state?: {
            location?: {
                pathname?: string
            }
        }
    }
    setAddons: Dispatch<SetStateAction<Addon[]>>
    setAllAchievements: Dispatch<SetStateAction<any[]>>
    setApp: Dispatch<SetStateAction<SettingsInterface>>
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
    setApp,
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
        const initializeApp = async () => {
            desktopApi.updates.start()
            desktopApi.music.checkInstall()
            desktopApi.lifecycle.ready()

            const [hydratedApp, musicStatus, musicVersion, fetchedAddons] = await Promise.all([
                fetchSettings(setApp),
                desktopApi.music.getStatus(),
                desktopApi.music.getVersion(),
                desktopApi.addons.list(),
            ])
            appRef.current = hydratedApp
            const resolvedMusicVersion = userId === '-1' ? config.AUTONOMOUS_MUSIC_VERSION : (musicVersion as string | null | undefined) || null

            setMusicInstalled(!!musicStatus)
            setMusicVersion(resolvedMusicVersion)
            setAddons((fetchedAddons as Addon[]) || [])

            try {
                const widgetExists = await desktopApi.widgets.checkObsInstalled()
                setWidgetInstalled(widgetExists || false)
            } catch (error) {
                console.error('Failed to check widget installation:', error)
                setWidgetInstalled(false)
            }

            await fetchModInfo(hydratedApp)

            if (userId !== '-1') {
                await fetchAchievements()
                return
            }

            setAllAchievements([])
            const routerPath = router && 'state' in router ? router.state?.location?.pathname : undefined
            if (routerPath === '/auth/callback') {
                await router.navigate('/home', { replace: true })
            }
        }

        void initializeApp()

        const modCheckId = setInterval(
            () => {
                void fetchModInfo(appRef.current)
            },
            10 * 60 * 1000,
        )

        return () => {
            clearInterval(modCheckId)
        }
    }, [
        appRef,
        fetchAchievements,
        fetchModInfo,
        router,
        setAddons,
        setAllAchievements,
        setApp,
        setMusicInstalled,
        setMusicVersion,
        setWidgetInstalled,
        userId,
    ])
}
