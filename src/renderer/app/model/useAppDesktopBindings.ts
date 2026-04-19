import { useCallback, useEffect } from 'react'
import { useRef } from 'react'

import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type Addon from '@entities/addon/model/addon.interface'
import rendererHttpClient from '@shared/api/http/client'
import toast from '@shared/ui/toast'
import { fetchSettings } from '@entities/settings/api/settings'

type Params = {
    appRef: React.MutableRefObject<SettingsInterface>
    authorize: () => Promise<void>
    fetchModInfo: (app: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => Promise<void>
    router: { navigate: (to: string, options?: any) => Promise<void> | void }
    setAddons: React.Dispatch<React.SetStateAction<Addon[]>>
    setApp: React.Dispatch<React.SetStateAction<SettingsInterface>>
    setHasToken: React.Dispatch<React.SetStateAction<boolean>>
    setNavigateState: React.Dispatch<React.SetStateAction<Addon | null>>
    setNavigateTo: React.Dispatch<React.SetStateAction<string | null>>
    setTokenReady: React.Dispatch<React.SetStateAction<boolean>>
    setUpdate: React.Dispatch<React.SetStateAction<boolean>>
    t: (key: string, options?: any) => string
    toastReference: React.MutableRefObject<string | null>
}

export function useAppDesktopBindings({
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
}: Params) {
    const manualUpdateCheckPendingRef = useRef(false)

    const invokeFileEvent = useCallback(async (eventType: string, filePath: string, data?: any) => {
        return await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, eventType, filePath, data)
    }, [])

    const handleOpenAddon = useCallback(
        (_event: any, data: string) => {
            window.desktopEvents
                ?.invoke(MainEvents.GET_ADDONS)
                .then((fetchedAddons: Addon[]) => {
                    const requested = String(data || '').toLowerCase()
                    const foundAddon = fetchedAddons.find(
                        addon =>
                            addon.name === data ||
                            addon.directoryName === data ||
                            addon.name.toLowerCase() === requested ||
                            addon.directoryName.toLowerCase() === requested,
                    )

                    if (!foundAddon) return

                    if (!foundAddon.type || (foundAddon.type !== 'theme' && foundAddon.type !== 'script')) {
                        toast.custom('error', t('common.errorTitleShort'), t('addons.invalidType'), undefined, undefined, 15000)
                        return
                    }

                    setAddons(fetchedAddons)
                    setNavigateTo(`/${encodeURIComponent(foundAddon.directoryName)}`)
                    setNavigateState(foundAddon)
                })
                .catch(error => console.error('Error getting themes:', error))
        },
        [setAddons, setNavigateState, setNavigateTo, t],
    )

    useEffect(() => {
        window.desktopEvents?.on(RendererEvents.OPEN_ADDON, handleOpenAddon)
        window.desktopEvents?.on(RendererEvents.CHECK_FILE_EXISTS, (_event, filePath) => invokeFileEvent(RendererEvents.CHECK_FILE_EXISTS, filePath))
        window.desktopEvents?.on(RendererEvents.READ_FILE, (_event, filePath) => invokeFileEvent(RendererEvents.READ_FILE, filePath))
        window.desktopEvents?.on(RendererEvents.CREATE_CONFIG_FILE, (_event, filePath, defaultContent) =>
            invokeFileEvent(RendererEvents.CREATE_CONFIG_FILE, filePath, defaultContent),
        )
        window.desktopEvents?.on(RendererEvents.WRITE_FILE, (_event, filePath, data) => invokeFileEvent(RendererEvents.WRITE_FILE, filePath, data))

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.CREATE_CONFIG_FILE)
            window.desktopEvents?.removeAllListeners(RendererEvents.OPEN_ADDON)
            window.desktopEvents?.removeAllListeners(RendererEvents.CHECK_FILE_EXISTS)
            window.desktopEvents?.removeAllListeners(RendererEvents.READ_FILE)
            window.desktopEvents?.removeAllListeners(RendererEvents.WRITE_FILE)
        }
    }, [handleOpenAddon, invokeFileEvent])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return
        if (!window.desktopEvents) return

        const handleModUpdateCheck = async (_event: any, data?: { manual?: boolean }) => {
            await fetchModInfo(appRef.current, { manual: !!data?.manual })
        }

        const handleClientReady = () => {
            window.desktopEvents?.send(MainEvents.REFRESH_MOD_INFO)
            window.desktopEvents?.send(MainEvents.GET_TRACK_INFO)
        }

        const premiumUserCheck = async () => {
            const response = await rendererHttpClient.post<{
                expiresAt?: string
                ok?: boolean
                token?: string
            }>('/user/subscription/token', {
                auth: true,
            })
            const data = response.data
            if (data.ok) {
                window.desktopEvents?.send(MainEvents.SEND_PREMIUM_USER, {
                    ok: true,
                    token: data.token,
                    expiresAt: data.expiresAt,
                })
            }
        }

        const handleCheckUpdate = (_event: any, data: any) => {
            const isManualCheck = !!data?.manual
            const isChecking = !!data?.checking

            if (isManualCheck && isChecking) {
                manualUpdateCheckPendingRef.current = true
            }

            if (isManualCheck && isChecking && !toastReference.current) {
                toastReference.current = toast.custom('loading', t('updates.checkingTitle'), t('common.pleaseWait'))
            }

            if (data?.updateAvailable === false) {
                setUpdate(false)

                if (isManualCheck && !isChecking) {
                    if (toastReference.current) {
                        toast.update(toastReference.current, {
                            kind: 'info',
                            title: t('updates.notFoundTitle'),
                            msg: t('updates.notFoundMessage'),
                            sticky: false,
                            duration: 5000,
                        })
                    } else {
                        toast.custom('info', t('updates.notFoundTitle'), t('updates.notFoundMessage'))
                    }
                    manualUpdateCheckPendingRef.current = false
                } else if (toastReference.current) {
                    toast.dismiss(toastReference.current)
                }
                toastReference.current = null
            }
        }

        const onDownloadProgress = (_event: any, value: number) => {
            if (!toastReference.current) {
                toastReference.current = toast.custom('loading', t('updates.downloadingTitle'), t('common.pleaseWait'))
            }
            toast.update(toastReference.current, {
                kind: 'loading',
                title: t('updates.downloadingTitle'),
                msg: t('updates.downloadingLabel'),
                value,
            })
        }

        const onDownloadFailed = () => {
            setUpdate(false)
            if (toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'error',
                    title: t('common.errorTitle'),
                    msg: t('updates.downloadError'),
                    sticky: false,
                })
            } else {
                toast.custom('error', t('common.errorTitle'), t('updates.downloadError'))
            }
            toastReference.current = null
        }

        const onDownloadFinished = () => {
            manualUpdateCheckPendingRef.current = false
            if (toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'success',
                    title: t('common.successTitle'),
                    msg: t('updates.downloaded'),
                    sticky: false,
                    duration: 5000,
                })
            }
            toastReference.current = null
            setUpdate(true)
        }

        const handleUpdateAvailable = async () => {
            manualUpdateCheckPendingRef.current = false
            const nextStatus = await window.desktopEvents?.invoke(MainEvents.GET_UPDATE_STATUS)
            setUpdate(nextStatus === 'DOWNLOADED')
        }

        window.desktopEvents?.on(RendererEvents.CHECK_MOD_UPDATE, handleModUpdateCheck)
        window.desktopEvents?.on(RendererEvents.CLIENT_READY, handleClientReady)
        window.desktopEvents?.on(RendererEvents.IS_PREMIUM_USER, premiumUserCheck)
        window.desktopEvents?.invoke(MainEvents.GET_VERSION).then((version: string) => {
            setApp(prevSettings => ({
                ...prevSettings,
                info: {
                    ...prevSettings.info,
                    version,
                },
            }))
        })
        window.desktopEvents?.on(RendererEvents.CHECK_UPDATE, handleCheckUpdate)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, onDownloadProgress)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FAILED, onDownloadFailed)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FINISHED, onDownloadFinished)
        window.desktopEvents?.on(RendererEvents.UPDATE_AVAILABLE, handleUpdateAvailable)

        void fetchSettings(setApp)

        return () => {
            const cleanupEvents = [
                RendererEvents.CHECK_MOD_UPDATE,
                RendererEvents.CLIENT_READY,
                RendererEvents.DOWNLOAD_UPDATE_PROGRESS,
                RendererEvents.DOWNLOAD_UPDATE_FAILED,
                RendererEvents.DOWNLOAD_UPDATE_FINISHED,
                RendererEvents.CHECK_UPDATE,
                RendererEvents.UPDATE_AVAILABLE,
            ]

            cleanupEvents.forEach(event => {
                window.desktopEvents?.removeAllListeners(event)
            })
        }
    }, [appRef, fetchModInfo, setApp, setUpdate, t, toastReference])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return
        ;(window as any).setToken = async (args: any) => {
            window.electron.store.set('tokens.token', args)
            setHasToken(true)
            setTokenReady(true)
            await authorize()
        }
        ;(window as any).refreshAddons = async (_args: any) => {
            window.desktopEvents.invoke(MainEvents.GET_ADDONS).then((fetchedAddons: Addon[]) => {
                setAddons(fetchedAddons)
                router.navigate('/extensions', { replace: true })
            })
        }
        ;(window as any).getModInfo = async (currentApp: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => {
            await fetchModInfo(currentApp, options)
        }
    }, [authorize, fetchModInfo, router, setAddons, setHasToken, setTokenReady])
}
