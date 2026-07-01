import { useCallback, useEffect } from 'react'
import { useRef } from 'react'

import type SettingsInterface from '@entities/settings/model/settings.interface'
import type Addon from '@entities/addon/model/addon.interface'
import rendererHttpClient from '@shared/api/http/client'
import toast from '@shared/ui/toast'
import { fetchSettings } from '@entities/settings/api/settings'
import { desktopApi } from '@shared/desktop/desktopApi'
import { setCachedUserToken } from '@shared/lib/auth/getUserToken'

const CLIENT_UPDATE_TOAST_ID = 'client-update-progress'

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

    const handleOpenAddon = useCallback(
        (data: unknown) => {
            const addonName = String(data || '')
            desktopApi.addons
                .list()
                .then(result => {
                    const fetchedAddons = result as Addon[]
                    const requested = addonName.toLowerCase()
                    const foundAddon = fetchedAddons.find(
                        addon =>
                            addon.name === addonName ||
                            addon.directoryName === addonName ||
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
        const unsubscribeOpenAddon = desktopApi.addons.onOpenRequested(handleOpenAddon)

        return () => {
            unsubscribeOpenAddon()
        }
    }, [handleOpenAddon])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return

        const handleModUpdateCheck = async (data?: { manual?: boolean }) => {
            await fetchModInfo(appRef.current, { manual: !!data?.manual })
        }

        const handleClientReady = () => {
            desktopApi.music.refreshModInfo()
            desktopApi.music.requestTrackInfo()
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
                desktopApi.auth.sendPremiumToken({
                    ok: true,
                    token: data.token,
                    expiresAt: data.expiresAt,
                })
            }
        }

        const handleCheckUpdate = (data: any) => {
            const isManualCheck = !!data?.manual
            const isChecking = !!data?.checking

            if (isManualCheck && isChecking) {
                manualUpdateCheckPendingRef.current = true
            }

            if (isManualCheck && isChecking && !toastReference.current) {
                toastReference.current = toast.custom('loading', t('updates.checkingTitle'), t('common.pleaseWait'), {
                    id: CLIENT_UPDATE_TOAST_ID,
                    duration: Infinity,
                })
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

        const onDownloadProgress = (value: any) => {
            if (!toastReference.current) {
                toastReference.current = toast.custom('loading', t('updates.downloadingTitle'), t('common.pleaseWait'), {
                    id: CLIENT_UPDATE_TOAST_ID,
                    duration: Infinity,
                })
            }
            toast.update(toastReference.current, {
                kind: 'loading',
                title: t('updates.downloadingTitle'),
                msg: t('updates.downloadingLabel'),
                value: Number(value) || 0,
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
            const nextStatus = await desktopApi.updates.getStatus()
            setUpdate(nextStatus === 'DOWNLOADED')
        }

        const unsubscribers = [
            desktopApi.mods.onUpdateCheckRequested(payload => handleModUpdateCheck(payload as { manual?: boolean })),
            desktopApi.music.onClientReady(handleClientReady),
            desktopApi.auth.onPremiumTokenRequested(premiumUserCheck),
            desktopApi.updates.onCheck(handleCheckUpdate),
            desktopApi.updates.onDownloadProgress(onDownloadProgress),
            desktopApi.updates.onDownloadFailed(onDownloadFailed),
            desktopApi.updates.onDownloadFinished(onDownloadFinished),
            desktopApi.updates.onAvailable(handleUpdateAvailable),
        ]

        desktopApi.getRuntimeInfo().then(runtimeInfo => {
            setApp(prevSettings => ({
                ...prevSettings,
                info: {
                    ...prevSettings.info,
                    version: runtimeInfo.clientVersion,
                    branch: runtimeInfo.buildIdentity.commit,
                },
            }))
        })

        void fetchSettings(setApp)

        return () => {
            unsubscribers.forEach(unsubscribe => unsubscribe())
        }
    }, [appRef, fetchModInfo, setApp, setUpdate, t, toastReference])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return
        ;(window as any).setToken = async (args: any) => {
            await desktopApi.auth.setToken(String(args || ''))
            setCachedUserToken(String(args || ''))
            setHasToken(true)
            setTokenReady(true)
            await authorize()
        }
    }, [authorize, setHasToken, setTokenReady])
}
