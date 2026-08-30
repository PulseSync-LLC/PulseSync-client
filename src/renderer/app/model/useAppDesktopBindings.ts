import { useCallback, useEffect, useRef } from 'react'

import rendererHttpClient from '@shared/api/http/client'
import { desktopApi } from '@shared/desktop/desktopApi'
import { setCachedUserToken } from '@shared/lib/auth/getUserToken'
import toast from '@shared/ui/toast'

import type { DesktopUpdateAvailablePayload } from '@common/desktopApi/contract'
import type Addon from '@entities/addon/model/addon.interface'
import type SettingsInterface from '@entities/settings/model/settings.interface'

const CLIENT_UPDATE_TOAST_ID = 'client-update-progress'

type Params = {
    appRef: React.MutableRefObject<SettingsInterface>
    authorize: () => Promise<void>
    fetchModInfo: (app: SettingsInterface, options?: { manual?: boolean; silentNotInstalled?: boolean }) => Promise<void>
    router: { navigate: (to: string, options?: any) => Promise<void> | void }
    setAddons: React.Dispatch<React.SetStateAction<Addon[]>>
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
    setHasToken,
    setNavigateState,
    setNavigateTo,
    setTokenReady,
    setUpdate,
    t,
    toastReference,
}: Params) {
    const manualUpdateCheckPendingRef = useRef(false)
    const rendererUpdateAvailableRef = useRef(false)

    const handleOpenAddon = useCallback(
        (data: unknown) => {
            if (data && typeof data === 'object' && 'storeAddonId' in data) {
                const storeAddonId = String((data as { storeAddonId?: unknown }).storeAddonId || '').trim()
                if (storeAddonId) {
                    void router.navigate('/store', { state: { openAddonId: storeAddonId } })
                }
                return
            }

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
        [router, setAddons, setNavigateState, setNavigateTo, t],
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
                toastReference.current = toast.custom('loading', t('updates.checkingTitle'), t('common.pleaseWait'), {
                    id: CLIENT_UPDATE_TOAST_ID,
                    duration: Infinity,
                })
            }

            if (data?.updateAvailable === false) {
                setUpdate(rendererUpdateAvailableRef.current)

                if (isManualCheck && !isChecking) {
                    manualUpdateCheckPendingRef.current = false
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
            manualUpdateCheckPendingRef.current = false
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
            manualUpdateCheckPendingRef.current = false
            setUpdate(rendererUpdateAvailableRef.current)
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

        const handleUpdateAvailable = async (payload: DesktopUpdateAvailablePayload) => {
            const isManualCheck = manualUpdateCheckPendingRef.current
            manualUpdateCheckPendingRef.current = false

            if (isManualCheck && toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'info',
                    title: t('modals.appUpdate.title'),
                    msg: t('modals.appUpdate.description'),
                    sticky: false,
                    duration: 5000,
                })
            }

            if (payload.kind === 'renderer') {
                rendererUpdateAvailableRef.current = true
                if (!isManualCheck) toast.dismiss(CLIENT_UPDATE_TOAST_ID)
                toastReference.current = null
                setUpdate(true)
                return
            }
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

        return () => {
            unsubscribers.forEach(unsubscribe => unsubscribe())
        }
    }, [appRef, fetchModInfo, setUpdate, t, toastReference])

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
