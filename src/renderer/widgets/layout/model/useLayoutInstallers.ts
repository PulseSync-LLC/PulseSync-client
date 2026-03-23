import { useCallback, useEffect, useRef, useState } from 'react'
import * as semver from 'semver'

import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import { isDev, isDevmark } from '@common/appConfig'
import toast from '@shared/ui/toast'
import { errorTypesToShow } from '@shared/lib/utils'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type { ModalName } from '@app/providers/modal/types'

type Params = {
    app: SettingsInterface
    modInfo: ModInterface[]
    modInfoFetched: boolean
    musicInstalled: boolean
    openModal: (modal: ModalName) => void
    setApp: React.Dispatch<React.SetStateAction<SettingsInterface>>
    setMusicInstalled: React.Dispatch<React.SetStateAction<boolean>>
    setMusicVersion: React.Dispatch<React.SetStateAction<string | null>>
    setUpdate: React.Dispatch<React.SetStateAction<boolean>>
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
    modInfoFetched,
    musicInstalled,
    openModal,
    setApp,
    setMusicInstalled,
    setMusicVersion,
    setUpdate,
    t,
    modals,
}: Params) {
    const [isUpdating, setIsUpdating] = useState(false)
    const [isMusicUpdating, setIsMusicUpdating] = useState(false)
    const [isModUpdateAvailable, setIsModUpdateAvailable] = useState(false)
    const [isForceInstallEnabled, setForceInstallEnabled] = useState(false)
    const [modUpdateState, setModUpdateState] = useState({
        isVersionOutdated: false,
        updateUrl: '',
    })

    const downloadToastIdRef = useRef<string | null>(null)
    const toastReference = useRef<string | null>(null)

    const clean = useCallback((version: string) => semver.valid(String(version ?? '').trim()) ?? '0.0.0', [])

    const readInstalledModFromStore = useCallback(() => {
        const version = String(window.electron.store.get('mod.version') || '')
        const name = String(window.electron.store.get('mod.name') || '')
        const musicVersion = String(window.electron.store.get('mod.musicVersion') || '')
        const installed = Boolean(window.electron.store.get('mod.installed'))

        return { version, name, musicVersion, installed }
    }, [])

    const isUserDeveloper = useCallback((userPerms?: string) => {
        return userPerms === 'developer' || isDev
    }, [])

    useEffect(() => {
        const serverRaw = modInfo[0]?.modVersion
        if (!serverRaw) return

        const serverVer = clean(serverRaw)
        const localVer = clean(app.mod?.version)
        setIsModUpdateAvailable(musicInstalled && (!app.mod.installed || semver.gt(serverVer, localVer)))
    }, [app.mod.installed, app.mod.version, clean, modInfo, musicInstalled])

    useEffect(() => {
        if ((window as any).__listenersAdded) return
        ;(window as any).__listenersAdded = true

        const handleProgress = (_: any, { progress, name }: { progress: number; name: string }) => {
            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
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
                    { duration: Infinity },
                    progress,
                )
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = (_: any, data: any) => {
            const installedMod = readInstalledModFromStore()
            const installedEntry = modInfo.find(mod => mod.modVersion === installedMod.version)

            if (downloadToastIdRef.current) {
                toast.custom(
                    'success',
                    data.message || (app.mod.installed ? t('layout.modUpdateSuccess') : t('layout.modInstallSuccess')),
                    t('common.doneTitle'),
                    { id: downloadToastIdRef.current },
                )
                downloadToastIdRef.current = null
            } else {
                toast.custom(
                    'success',
                    data.message || (app.mod.installed ? t('layout.modUpdateSuccess') : t('layout.modInstallSuccess')),
                    t('common.doneTitle'),
                )
            }

            if (!installedMod.installed || !installedMod.version) {
                toast.custom('error', t('common.somethingWrongTitle'), t('layout.modInstallUpdateError'))
                setIsUpdating(false)
                return
            }

            setApp(prevApp => ({
                ...prevApp,
                mod: {
                    ...prevApp.mod,
                    installed: installedMod.installed,
                    version: installedMod.version,
                    name: installedMod.name,
                    musicVersion: installedMod.musicVersion,
                    updated: prevApp.mod.installed ? true : prevApp.mod.updated,
                },
            }))

            if (installedEntry?.showModal || app.settings.showModModalAfterInstall) {
                openModal(modals.MOD_CHANGELOG)
            }

            setForceInstallEnabled(false)
            Promise.all([window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS), window.desktopEvents?.invoke(MainEvents.GET_MUSIC_VERSION)]).then(
                ([status, version]) => {
                    setMusicInstalled(Boolean(status))
                    setMusicVersion(version ?? null)
                },
            )
            setIsUpdating(false)
        }

        const handleFailure = (_: any, error: any) => {
            const getErrorMessage = () => {
                if (errorTypesToShow.has(error.type)) {
                    return t('layout.errorWithMessage', { message: error.error || t('layout.unknownError') })
                }
                return app.mod.installed ? t('layout.modUpdateFailed') : t('layout.modInstallFailed')
            }

            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
                    kind: 'error',
                    title: t('layout.errorOccurred'),
                    msg: getErrorMessage(),
                    sticky: false,
                    value: 0,
                })
                downloadToastIdRef.current = null
            } else {
                toast.custom('error', t('layout.errorOccurred'), getErrorMessage())
            }

            if (error.type === 'version_too_new') {
                setForceInstallEnabled(true)
            }
            if (error.type === 'version_outdated') {
                setModUpdateState({
                    isVersionOutdated: true,
                    updateUrl: error.url,
                })
            }
            if (error.type === 'linux_permissions_required' && window.electron.isLinux()) {
                openModal(modals.LINUX_PERMISSIONS_MODAL)
            }
            setIsUpdating(false)
        }

        window.desktopEvents?.on(RendererEvents.DOWNLOAD_PROGRESS, handleProgress)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_SUCCESS, handleSuccess)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_FAILURE, handleFailure)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_PROGRESS)
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_SUCCESS)
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_FAILURE)
            ;(window as any).__listenersAdded = false
        }
    }, [
        app.mod.installed,
        app.settings.showModModalAfterInstall,
        modInfo,
        modals.LINUX_PERMISSIONS_MODAL,
        modals.MOD_CHANGELOG,
        openModal,
        readInstalledModFromStore,
        setApp,
        setMusicInstalled,
        setMusicVersion,
        t,
    ])

    useEffect(() => {
        if ((window as any).__musicEventListeners) return
        ;(window as any).__musicEventListeners = true

        const onProgressUpdate = (_: any, { progress }: { progress: number }) => {
            if (toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'loading',
                    title: t('layout.musicDownloadProgressLabel'),
                    msg: t('layout.downloading', { name: t('layout.musicAppName') }),
                    value: progress,
                })
            } else {
                const id = toast.custom(
                    'loading',
                    t('layout.musicDownloadProgressLabel'),
                    t('layout.downloading', { name: t('layout.musicAppName') }),
                    { duration: Infinity },
                    progress,
                )
                toastReference.current = id
            }
        }

        const onUpdateFailure = (_: any, error: any) => {
            if (toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'error',
                    title: t('layout.errorWithMessage', { message: error.error }),
                    msg: !musicInstalled ? t('layout.musicInstallFailed') : t('layout.musicUpdateFailed'),
                    sticky: false,
                    value: 0,
                })
                toastReference.current = null
            } else {
                toast.custom(
                    'error',
                    t('layout.errorWithMessage', { message: error.error }),
                    !musicInstalled ? t('layout.musicInstallFailed') : t('layout.musicUpdateFailed'),
                )
            }
            setIsMusicUpdating(false)
        }

        const onExecutionComplete = async (_: any, data: any) => {
            if (toastReference.current) {
                toast.custom(
                    'success',
                    t('common.successTitle'),
                    !musicInstalled || !data?.installed ? t('layout.musicInstallSuccess') : t('layout.musicUpdateSuccess'),
                    { id: toastReference.current },
                )
                toastReference.current = null
                setModUpdateState({ isVersionOutdated: false, updateUrl: '' })
                setIsMusicUpdating(false)
                const [status, version] = await Promise.all([
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS),
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_VERSION),
                ])
                setMusicInstalled(Boolean(status))
                setMusicVersion(version ?? null)
                if (data?.type === 'reinstall') {
                    setApp(prevApp => {
                        const updatedApp = {
                            ...prevApp,
                            mod: {
                                ...prevApp.mod,
                                installed: false,
                                version: '',
                            },
                        }
                        window.getModInfo(updatedApp)
                        window.electron.store.delete('mod')
                        return updatedApp
                    })
                }
            }
        }

        window.desktopEvents?.on(RendererEvents.DOWNLOAD_MUSIC_PROGRESS, onProgressUpdate)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_MUSIC_FAILURE, onUpdateFailure)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS, onExecutionComplete)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_MUSIC_PROGRESS)
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_MUSIC_FAILURE)
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_MUSIC_EXECUTION_SUCCESS)
            ;(window as any).__musicEventListeners = false
        }
    }, [musicInstalled, setApp, setMusicInstalled, setMusicVersion, t])

    const updateYandexMusic = useCallback(() => {
        if (isMusicUpdating) {
            toast.custom('info', t('layout.infoTitle'), t('layout.updateAlreadyRunning'))
            return
        }
        window.desktopEvents?.send(MainEvents.DOWNLOAD_YANDEX_MUSIC, modUpdateState.updateUrl)
        setIsMusicUpdating(true)
    }, [isMusicUpdating, modUpdateState.updateUrl, t])

    const startUpdate = useCallback(
        (force?: boolean) => {
            if (window.electron.isLinux()) {
                const savedPath = window.electron.store.get('settings.modSavePath')
                if (!savedPath) {
                    openModal(modals.LINUX_ASAR_PATH)
                    return
                }
            }
            if (isUpdating) {
                toast.custom(
                    'error',
                    t('common.errorTitle'),
                    app.mod.installed ? t('layout.modUpdateAlreadyRunning') : t('layout.modInstallAlreadyRunning'),
                )
                return
            }
            if (modInfo.length === 0) {
                toast.custom(
                    'error',
                    app.mod.installed ? t('layout.noModUpdatesAvailable') : t('layout.noModInstallsAvailable'),
                    app.mod.installed ? t('layout.modUpdateLoadError') : t('layout.modInstallErrorTitle'),
                )
                return
            }

            setIsUpdating(true)
            const id = toast.custom('loading', app.mod.installed ? t('layout.modUpdateStart') : t('layout.modInstallStart'), t('common.pleaseWait'))
            downloadToastIdRef.current = id

            const { modVersion, realMusicVersion, downloadUrl, checksum_v2, spoof, name, shouldReinstall, downloadUnpackedUrl, unpackedChecksum } =
                modInfo[0]

            window.desktopEvents?.send(MainEvents.INSTALL_MOD, {
                version: modVersion,
                musicVersion: realMusicVersion,
                name,
                link: downloadUrl,
                unpackLink: downloadUnpackedUrl,
                unpackedChecksum,
                checksum: checksum_v2,
                shouldReinstall,
                force: force || false,
                spoof: spoof || false,
            })
        },
        [app.mod.installed, isUpdating, modInfo, modals.LINUX_ASAR_PATH, openModal, t],
    )

    useEffect(() => {
        if (!modInfoFetched || modInfo.length === 0 || isUpdating || !app.mod.installed || !app.mod.version) return
        const currentEntry = modInfo.find(mod => mod.modVersion === app.mod.version)
        if (!currentEntry?.deprecated) return

        const availableVersions = modInfo.map(mod => mod.modVersion).filter(version => semver.valid(version))
        const latestVersion = availableVersions.sort(semver.rcompare)[0]
        if (semver.gt(latestVersion, app.mod.version)) {
            toast.custom(
                'info',
                t('layout.installedVersionOutdated', { version: app.mod.version }),
                t('layout.newVersionFound', { version: latestVersion }),
                undefined,
                15000,
            )
            startUpdate()
        }
    }, [app.mod.installed, app.mod.version, isUpdating, modInfo, modInfoFetched, startUpdate, t])

    useEffect(() => {
        if (isDevmark) {
            document.body.classList.add('devmark-border')
        } else {
            document.body.classList.remove('devmark-border')
        }
        return () => {
            document.body.classList.remove('devmark-border')
        }
    }, [])

    return {
        isForceInstallEnabled,
        isModUpdateAvailable,
        modUpdateState,
        startUpdate,
        updateYandexMusic,
        isUserDeveloper,
    }
}
