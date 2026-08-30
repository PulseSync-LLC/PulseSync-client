import { useCallback, useEffect, useRef, useState } from 'react'

import { isDev } from '@common/appConfig'
import { installModRelease } from '@entities/mod/lib/installModRelease'
import { isModReleaseUpdateAvailable } from '@entities/mod/lib/modReleaseUpdate'
import { desktopApi } from '@shared/desktop/desktopApi'
import { errorTypesToShow } from '@shared/lib/utils'
import toast from '@shared/ui/toast'

import type { ModalName } from '@app/providers/modal/types'
import type { DesktopInstallModRequest } from '@common/desktopApi/contract'
import type { ModReleaseChannel } from '@common/types/modSource'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type SettingsInterface from '@entities/settings/model/settings.interface'

const MOD_DOWNLOAD_TOAST_ID = 'mod-download-progress'

type Params = {
    app: SettingsInterface
    modInfo: ModInterface[]
    musicInstalled: boolean
    openModal: (modal: ModalName) => void
    setApp: React.Dispatch<React.SetStateAction<SettingsInterface>>
    setMusicInstalled: React.Dispatch<React.SetStateAction<boolean>>
    setMusicVersion: React.Dispatch<React.SetStateAction<string | null>>
    t: (key: string, options?: any) => string
    modals: {
        LINUX_ASAR_PATH: ModalName
        LINUX_PERMISSIONS_MODAL: ModalName
        MOD_CHANGELOG: ModalName
    }
}

export function useLayoutInstallers({
    app,
    modInfo,
    musicInstalled,
    openModal,
    setApp,
    setMusicInstalled,
    setMusicVersion,
    t,
    modals,
}: Params) {
    const [isUpdating, setIsUpdating] = useState(false)
    const [isModUpdateAvailable, setIsModUpdateAvailable] = useState(false)
    const [modInstallError, setModInstallError] = useState<{ details: string; showProxyHint: boolean; title: string } | null>(null)
    const hasInstalledMod = Boolean(app.mod.installed && app.mod.version)

    const downloadToastIdRef = useRef<string | null>(null)
    const preparedUpdateRef = useRef<DesktopInstallModRequest | null>(null)
    const appRef = useRef(app)
    const modInfoRef = useRef(modInfo)
    const currentModActionRef = useRef<'install' | 'update'>(hasInstalledMod ? 'update' : 'install')

    const readInstalledModSnapshot = useCallback(async () => {
        const snapshot = await desktopApi.settings.getSnapshot()
        const version = String(snapshot.mod.version || '')
        const name = String(snapshot.mod.name || '')
        const musicVersion = String(snapshot.mod.musicVersion || '')
        const installed = Boolean(snapshot.mod.installed)
        const sourceType: ModReleaseChannel = snapshot.mod.sourceType === 'branch' ? 'branch' : 'stable'
        const branch = String(snapshot.mod.branch || '')
        const commit = String(snapshot.mod.commit || '')

        return { version, name, musicVersion, installed, sourceType, branch, commit }
    }, [])

    const isUserDeveloper = useCallback((userPerms?: string) => {
        return userPerms === 'developer' || isDev
    }, [])

    useEffect(() => {
        appRef.current = app
    }, [app])

    useEffect(() => {
        modInfoRef.current = modInfo
    }, [modInfo])

    const getModInstallErrorText = useCallback(
        (error: any) => {
            const rawMessage = typeof error?.error === 'string' ? error.error.trim() : ''
            const normalizedMessage =
                rawMessage && rawMessage.toLowerCase().includes('aborted')
                    ? t('layout.modInstallInterrupted')
                    : rawMessage || t('layout.unknownError')
            const isUpdate = currentModActionRef.current === 'update'

            const details = errorTypesToShow.has(error?.type)
                ? t('layout.errorWithMessage', { message: normalizedMessage })
                : isUpdate
                  ? t('layout.modUpdateFailed')
                  : t('layout.modInstallFailed')

            const title =
                error?.type === 'download_error' || error?.type === 'download_unpacked_error'
                    ? isUpdate
                        ? t('layout.modUpdateLoadError')
                        : t('layout.modInstallErrorTitle')
                    : t('layout.errorOccurred')

            const showProxyHint = error?.type === 'download_error' || error?.type === 'download_unpacked_error'

            return { details, showProxyHint, title }
        },
        [t],
    )

    useEffect(() => {
        setIsModUpdateAvailable(musicInstalled && (!hasInstalledMod || isModReleaseUpdateAvailable(modInfo[0], app.mod)))
    }, [app.mod, hasInstalledMod, modInfo, musicInstalled])

    useEffect(() => {
        if ((window as any).__listenersAdded) return
        ;(window as any).__listenersAdded = true

        const handleModInstallStarted = (data?: { isUpdate?: boolean }) => {
            const wasInstalled = Boolean(appRef.current.mod.installed && appRef.current.mod.version)
            const isUpdate = (typeof data?.isUpdate === 'boolean' ? data.isUpdate : wasInstalled) && wasInstalled
            currentModActionRef.current = isUpdate ? 'update' : 'install'
            setIsUpdating(true)
            setModInstallError(null)

            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
                    action: undefined,
                    kind: 'loading',
                    title: isUpdate ? t('layout.modUpdateInstalling') : t('layout.modInstallStart'),
                    msg: t('layout.modInstallDescription'),
                    sticky: true,
                })
                return
            }

            downloadToastIdRef.current = toast.custom(
                'loading',
                isUpdate ? t('layout.modUpdateInstalling') : t('layout.modInstallStart'),
                t('layout.modInstallDescription'),
                { id: MOD_DOWNLOAD_TOAST_ID, duration: Infinity },
            )
        }

        const handleUpdateDownloadStarted = () => {
            currentModActionRef.current = 'update'
            preparedUpdateRef.current = null
            setIsUpdating(true)
            setModInstallError(null)

            downloadToastIdRef.current = toast.custom('loading', t('layout.modUpdateStart'), t('common.pleaseWait'), {
                id: MOD_DOWNLOAD_TOAST_ID,
                duration: Infinity,
            })
        }

        const handleProgress = ({ progress, name }: { progress: number; name: string }) => {
            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
                    action: undefined,
                    kind: 'loading',
                    title: t('layout.downloadProgressLabel'),
                    msg: t('layout.downloading', { name }),
                    value: progress,
                })
            } else {
                const id = toast.custom(
                    'loading',
                    t('layout.downloadProgressLabel'),
                    t('layout.downloading', { name }),
                    { id: MOD_DOWNLOAD_TOAST_ID, duration: Infinity },
                    progress,
                )
                downloadToastIdRef.current = id
            }
        }

        const handleUpdateReady = (data: { release?: DesktopInstallModRequest }) => {
            if (!data?.release) return

            preparedUpdateRef.current = data.release
            setIsUpdating(false)
            const installPreparedUpdate = () => {
                const release = preparedUpdateRef.current
                if (!release) return

                currentModActionRef.current = 'update'
                setIsUpdating(true)
                if (downloadToastIdRef.current) {
                    toast.update(downloadToastIdRef.current, {
                        action: undefined,
                        kind: 'loading',
                        title: t('layout.modUpdateInstalling'),
                        msg: t('common.pleaseWait'),
                        sticky: true,
                        value: 0,
                    })
                }
                desktopApi.mods.install(release)
            }

            downloadToastIdRef.current = toast.custom(
                'success',
                t('layout.modUpdateReadyTitle'),
                t('layout.modUpdateReadyDescription', { version: data.release.version }),
                { id: MOD_DOWNLOAD_TOAST_ID, duration: Infinity },
                100,
            )
            toast.update(downloadToastIdRef.current, {
                action: {
                    label: t('layout.installPreparedUpdateAction'),
                    onClick: installPreparedUpdate,
                },
                sticky: true,
            })
        }

        const handleSuccess = async (data: any) => {
            const installedMod = await readInstalledModSnapshot()
            setModInstallError(null)
            preparedUpdateRef.current = null
            const isUpdate = currentModActionRef.current === 'update'

            if (!installedMod.installed || !installedMod.version) {
                const title = t('common.somethingWrongTitle')
                const details = t('layout.modInstallUpdateError')

                if (downloadToastIdRef.current) {
                    toast.update(downloadToastIdRef.current, {
                        kind: 'error',
                        title,
                        msg: details,
                        sticky: false,
                        duration: 15000,
                        value: 0,
                    })
                    downloadToastIdRef.current = null
                } else {
                    toast.custom('error', title, details)
                }

                setIsUpdating(false)
                return
            }

            const installedEntry = modInfoRef.current.find(mod => mod.modVersion === installedMod.version)

            if (downloadToastIdRef.current) {
                toast.custom(
                    'success',
                    data.message || (isUpdate ? t('layout.modUpdateSuccess') : t('layout.modInstallSuccess')),
                    t('common.doneTitle'),
                    { id: downloadToastIdRef.current },
                )
                downloadToastIdRef.current = null
            } else {
                toast.custom(
                    'success',
                    data.message || (isUpdate ? t('layout.modUpdateSuccess') : t('layout.modInstallSuccess')),
                    t('common.doneTitle'),
                )
            }

            setApp(prevApp => ({
                ...prevApp,
                mod: {
                    ...prevApp.mod,
                    installed: installedMod.installed,
                    version: installedMod.version,
                    name: installedMod.name,
                    musicVersion: installedMod.musicVersion,
                    sourceType: installedMod.sourceType,
                    branch: installedMod.branch,
                    commit: installedMod.commit,
                    updated: prevApp.mod.installed ? true : prevApp.mod.updated,
                },
            }))

            if (installedEntry?.showModal || appRef.current.settings.showModModalAfterInstall) {
                openModal(modals.MOD_CHANGELOG)
            }

            const [status, version] = await Promise.all([desktopApi.music.getStatus(), desktopApi.music.getVersion()])
            setMusicInstalled(Boolean(status))
            setMusicVersion(version ?? null)
            setIsUpdating(false)
        }

        const handleFailure = (error: any) => {
            const errorPresentation = getModInstallErrorText(error)
            console.error('[LayoutInstallers] Mod install failed', {
                action: currentModActionRef.current,
                error,
                errorPresentation,
            })
            setModInstallError(errorPresentation)
            preparedUpdateRef.current = null

            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
                    kind: 'error',
                    title: errorPresentation.title,
                    msg: errorPresentation.details,
                    sticky: false,
                    duration: 15000,
                    value: 0,
                })
                downloadToastIdRef.current = null
            } else {
                toast.custom('error', errorPresentation.title, errorPresentation.details, undefined, undefined, 15000)
            }

            desktopApi.getRuntimeInfo().then(runtimeInfo => {
                if (error.type === 'linux_permissions_required' && runtimeInfo.isLinux) {
                    openModal(modals.LINUX_PERMISSIONS_MODAL)
                }
            })
            setIsUpdating(false)
        }

        const unsubscribeInstallStarted = desktopApi.mods.onInstallStarted(handleModInstallStarted as (payload: unknown) => void)
        const unsubscribeUpdateDownloadStarted = desktopApi.mods.onUpdateDownloadStarted(handleUpdateDownloadStarted)
        const unsubscribeUpdateReady = desktopApi.mods.onUpdateReady(payload => handleUpdateReady(payload as { release?: DesktopInstallModRequest }))
        const unsubscribeDownloadProgress = desktopApi.mods.onDownloadProgress(handleProgress as (payload: unknown) => void)
        const unsubscribeDownloadSuccess = desktopApi.mods.onDownloadSuccess(handleSuccess)
        const unsubscribeDownloadFailure = desktopApi.mods.onDownloadFailure(handleFailure)

        return () => {
            unsubscribeInstallStarted()
            unsubscribeUpdateDownloadStarted()
            unsubscribeUpdateReady()
            unsubscribeDownloadProgress()
            unsubscribeDownloadSuccess()
            unsubscribeDownloadFailure()
            ;(window as any).__listenersAdded = false
        }
    }, [
        getModInstallErrorText,
        modals.LINUX_PERMISSIONS_MODAL,
        modals.MOD_CHANGELOG,
        openModal,
        readInstalledModSnapshot,
        setApp,
        setMusicInstalled,
        setMusicVersion,
        t,
    ])

    const startUpdate = useCallback(async () => {
        const runtimeInfo = await desktopApi.getRuntimeInfo()
        if (runtimeInfo.isLinux) {
            const snapshot = await desktopApi.settings.getSnapshot()
            const savedPath = snapshot.settings.modSavePath
            if (!savedPath) {
                openModal(modals.LINUX_ASAR_PATH)
                return
            }
        }
        if (isUpdating) {
            toast.custom(
                'error',
                t('common.errorTitle'),
                hasInstalledMod ? t('layout.modUpdateAlreadyRunning') : t('layout.modInstallAlreadyRunning'),
            )
            return
        }
        if (modInfo.length === 0) {
            toast.custom(
                'error',
                hasInstalledMod ? t('layout.noModUpdatesAvailable') : t('layout.noModInstallsAvailable'),
                hasInstalledMod ? t('layout.modUpdateLoadError') : t('layout.modInstallErrorTitle'),
            )
            return
        }

        setIsUpdating(true)
        setModInstallError(null)
        currentModActionRef.current = hasInstalledMod ? 'update' : 'install'
        const id = toast.custom('loading', hasInstalledMod ? t('layout.modUpdateStart') : t('layout.modInstallStart'), t('common.pleaseWait'), {
            id: MOD_DOWNLOAD_TOAST_ID,
            duration: Infinity,
        })
        downloadToastIdRef.current = id

        installModRelease(modInfo[0])
    }, [hasInstalledMod, isUpdating, modInfo, modals.LINUX_ASAR_PATH, openModal, t])

    return {
        isModUpdateAvailable,
        modInstallError,
        startUpdate,
        isUserDeveloper,
    }
}
