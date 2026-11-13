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
    setMusicInstalled: Dispatch<SetStateAction<boolean | null>>
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
            setAllAchievements([])
            achievementsUserIdRef.current = null
            setMusicVersion(config.AUTONOMOUS_MUSIC_VERSION)
            return
        }

        setMusicVersion(detectedMusicVersionRef.current)
        if (achievementsUserIdRef.current === userId) return
        achievementsUserIdRef.current = userId
        void fetchAchievements()
    }, [fetchAchievements, setAllAchievements, setMusicVersion, userId])

    useEffect(() => {
        if (initializationStartedRef.current) return
        initializationStartedRef.current = true

        const initializeApp = async () => {
            desktopApi.updates.start()
            desktopApi.lifecycle.ready()

            const [hydratedApp, fetchedAddons] = await Promise.all([fetchSettings(setApp), desktopApi.addons.list()])
            appRef.current = hydratedApp
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
    }, [appRef, fetchModInfo, router, setAddons, setApp, setWidgetInstalled])

    useEffect(() => {
        let disposed = false
        let checking = false
        let installed = false

        const refreshMusic = async () => {
            if (checking || installed) return
            checking = true
            try {
                const status = await desktopApi.music.getStatus()
                if (disposed) return
                if (!status) {
                    setMusicInstalled(false)
                    return
                }

                const version = await desktopApi.music.getVersion()
                if (disposed) return

                installed = true
                window.clearInterval(interval)
                detectedMusicVersionRef.current = version || null
                setMusicInstalled(true)
                if (userIdRef.current !== '-1') setMusicVersion(detectedMusicVersionRef.current)
            } catch (error) {
                console.error('Failed to check Yandex Music installation:', error)
            } finally {
                checking = false
            }
        }

        const interval = window.setInterval(refreshMusic, 3000)
        void refreshMusic()
        window.addEventListener('focus', refreshMusic)
        return () => {
            disposed = true
            window.clearInterval(interval)
            window.removeEventListener('focus', refreshMusic)
        }
    }, [setMusicInstalled, setMusicVersion])

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
