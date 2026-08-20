import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef } from 'react'

import config from '@common/appConfig'
import { fetchSettings } from '@entities/settings/api/settings'
import { desktopApi } from '@shared/desktop/desktopApi'

import type Addon from '@entities/addon/model/addon.interface'
import type SettingsInterface from '@entities/settings/model/settings.interface'
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
    const initializationStartedRef = useRef(false)
    const detectedMusicVersionRef = useRef<string | null>(null)
    const achievementsUserIdRef = useRef<string | null>(null)
    const userIdRef = useRef(userId)

    useEffect(() => {
        userIdRef.current = userId
        if (userId === '-1') {
            setModInfoFetched(false)
            setAllAchievements([])
            achievementsUserIdRef.current = null
            setMusicVersion(config.AUTONOMOUS_MUSIC_VERSION)
            return
        }

        setMusicVersion(detectedMusicVersionRef.current)
        if (achievementsUserIdRef.current === userId) return
        achievementsUserIdRef.current = userId
        void fetchAchievements()
    }, [fetchAchievements, setAllAchievements, setModInfoFetched, setMusicVersion, userId])

    useEffect(() => {
        if (initializationStartedRef.current) return
        initializationStartedRef.current = true

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
            detectedMusicVersionRef.current = (musicVersion as string | null | undefined) || null
            const resolvedMusicVersion = userIdRef.current === '-1' ? config.AUTONOMOUS_MUSIC_VERSION : detectedMusicVersionRef.current

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

            const routerPath = router && 'state' in router ? router.state?.location?.pathname : undefined
            if (userIdRef.current === '-1' && routerPath === '/auth/callback') {
                await router.navigate('/home', { replace: true })
            }
        }

        void initializeApp()
    }, [appRef, fetchModInfo, router, setAddons, setApp, setMusicInstalled, setMusicVersion, setWidgetInstalled])

    useEffect(() => {
        const modCheckId = setInterval(
            () => {
                void fetchModInfo(appRef.current)
            },
            10 * 60 * 1000,
        )

        return () => {
            clearInterval(modCheckId)
        }
    }, [appRef, fetchModInfo])
}
