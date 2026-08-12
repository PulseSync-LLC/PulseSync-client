import { useCallback, useEffect, useRef, useState } from 'react'
import * as semver from 'semver'

import { isDev } from '@common/appConfig'
import toast from '@shared/ui/toast'
import { errorTypesToShow } from '@shared/lib/utils'
import type SettingsInterface from '@entities/settings/model/settings.interface'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type { ModalName } from '@app/providers/modal/types'
import { desktopApi } from '@shared/desktop/desktopApi'

const MOD_DOWNLOAD_TOAST_ID = 'mod-download-progress'

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
    const [isModUpdateAvailable, setIsModUpdateAvailable] = useState(false)
    const [modInstallError, setModInstallError] = useState<{ details: string; showProxyHint: boolean; title: string } | null>(null)

    const downloadToastIdRef = useRef<string | null>(null)
    const appRef = useRef(app)
    const modInfoRef = useRef(modInfo)
    const currentModActionRef = useRef<'install' | 'update'>(app.mod.installed ? 'update' : 'install')

    const clean = useCallback((version: string) => semver.valid(String(version ?? '').trim()) ?? '0.0.0', [])

    const readInstalledModSnapshot = useCallback(async () => {
        const snapshot = await desktopApi.settings.getSnapshot()
        const version = String(snapshot.mod.version || '')
        const name = String(snapshot.mod.name || '')
        const musicVersion = String(snapshot.mod.musicVersion || '')
        const installed = Boolean(snapshot.mod.installed)

        return { version, name, musicVersion, installed }
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
        const serverRaw = modInfo[0]?.modVersion
        if (!serverRaw) return

        const serverVer = clean(serverRaw)
        const localVer = clean(app.mod?.version)
        setIsModUpdateAvailable(musicInstalled && (!app.mod.installed || semver.gt(serverVer, localVer)))
    }, [app.mod.installed, app.mod.version, clean, modInfo, musicInstalled])

    useEffect(() => {
        if ((window as any).__listenersAdded) return
        ;(window as any).__listenersAdded = true

        const handleModInstallStarted = (data?: { isUpdate?: boolean }) => {
            const isUpdate = typeof data?.isUpdate === 'boolean' ? data.isUpdate : appRef.current.mod.installed
            currentModActionRef.current = isUpdate ? 'update' : 'install'
            setIsUpdating(true)
            setModInstallError(null)

            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
                    kind: 'loading',
                    title: isUpdate ? t('layout.modUpdateStart') : t('layout.modInstallStart'),
                    msg: t('layout.modInstallDescription'),
                    sticky: true,
                })
                return
            }

            downloadToastIdRef.current = toast.custom(
                'loading',
                isUpdate ? t('layout.modUpdateStart') : t('layout.modInstallStart'),
                t('layout.modInstallDescription'),
                { id: MOD_DOWNLOAD_TOAST_ID, duration: Infinity },
            )
        }

        const handleProgress = ({ progress, name }: { progress: number; name: string }) => {
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
                    { id: MOD_DOWNLOAD_TOAST_ID, duration: Infinity },
                    progress,
                )
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = async (data: any) => {
            const installedMod = await readInstalledModSnapshot()
            const installedEntry = modInfoRef.current.find(mod => mod.modVersion === installedMod.version)
            setModInstallError(null)
            const isUpdate = currentModActionRef.current === 'update'

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
        const unsubscribeDownloadProgress = desktopApi.mods.onDownloadProgress(handleProgress as (payload: unknown) => void)
        const unsubscribeDownloadSuccess = desktopApi.mods.onDownloadSuccess(handleSuccess)
        const unsubscribeDownloadFailure = desktopApi.mods.onDownloadFailure(handleFailure)

        return () => {
            unsubscribeInstallStarted()
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
        setModInstallError(null)
        currentModActionRef.current = app.mod.installed ? 'update' : 'install'
        const id = toast.custom('loading', app.mod.installed ? t('layout.modUpdateStart') : t('layout.modInstallStart'), t('common.pleaseWait'), {
            id: MOD_DOWNLOAD_TOAST_ID,
            duration: Infinity,
        })
        downloadToastIdRef.current = id

        const { modVersion, realMusicVersion, downloadUrl, checksum_v2, name, shouldReinstall, downloadUnpackedUrl, unpackedChecksum, source } =
            modInfo[0]

        desktopApi.mods.install({
            version: modVersion,
            musicVersion: realMusicVersion,
            name,
            link: downloadUrl,
            unpackLink: downloadUnpackedUrl,
            unpackedChecksum,
            checksum: checksum_v2,
            shouldReinstall,
            source: source || 'backend',
        })
    }, [app.mod.installed, isUpdating, modInfo, modals.LINUX_ASAR_PATH, openModal, t])

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
        if (app.info.devmark && app.settings.showDevFrame) {
            document.body.classList.add('devmark-border')
        } else {
            document.body.classList.remove('devmark-border')
        }
        return () => {
            document.body.classList.remove('devmark-border')
        }
    }, [app.info.devmark, app.settings.showDevFrame])

    return {
        isModUpdateAvailable,
        modInstallError,
        startUpdate,
        isUserDeveloper,
    }
}
