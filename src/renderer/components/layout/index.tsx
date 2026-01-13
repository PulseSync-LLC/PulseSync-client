import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Helmet, HelmetProvider } from '@dr.pogodin/react-helmet'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import {
    MdDownload,
    MdHandyman,
    MdKeyboardArrowRight,
    MdOutlineInstallDesktop,
    MdOutlineWarningAmber,
    MdPeople,
    MdPower,
    MdStoreMallDirectory,
    MdUpdate,
} from 'react-icons/md'
import Header from './header'
import NavButtonPulse from '../PSUI/NavButton'
import DiscordIcon from './../../../../static/assets/icons/discord.svg'
import Preloader from '../preloader'
import userContext from '../../api/context/user.context'
import SettingsInterface from '../../api/interfaces/settings.interface'
import toast from '../toast'
import * as pageStyles from './layout.module.scss'
import { isDev, isDevmark } from '../../api/web_config'
import TooltipButton from '../tooltip_button'
import store from '../../api/store/store'
import { openModal } from '../../api/store/modalSlice'
import { errorTypesToShow } from '../../utils/utils'
import { staticAsset } from '../../utils/staticAssets'
import * as semver from 'semver'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'

interface LayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, modInfo, features, musicInstalled, setMusicInstalled } = useContext(userContext)
    const { t } = useTranslation()

    const [isUpdating, setIsUpdating] = useState(false)
    const [isMusicUpdating, setIsMusicUpdating] = useState(false)
    const [loadingModInfo, setLoadingModInfo] = useState(true)
    const [isModUpdateAvailable, setIsModUpdateAvailable] = useState(false)
    const [isForceInstallEnabled, setForceInstallEnabled] = useState(false)
    const [modUpdateState, setModUpdateState] = useState({
        isVersionOutdated: false,
        updateUrl: '',
    })

    const downloadToastIdRef = useRef<string | null>(null)
    const toastReference = useRef<string | null>(null)
    const ffmpegToastIdRef = useRef<string | null>(null)

    const clean = useCallback((version: string) => semver.valid(String(version ?? '').trim()) ?? '0.0.0', [])

    useEffect(() => {
        setLoadingModInfo(modInfo.length === 0)
    }, [modInfo])

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

        const handleProgress = (_: any, { progress }: { progress: number }) => {
            if (downloadToastIdRef.current) {
                toast.update(downloadToastIdRef.current, {
                    kind: 'loading',
                    title: t('layout.downloadProgress', { progress }),
                    msg: t('layout.downloading'),
                    value: progress,
                })
            } else {
                const id = toast.custom(
                    'loading',
                    t('layout.downloadProgress', { progress }),
                    t('layout.downloading'),
                    { duration: Infinity },
                    progress,
                )
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = (_: any, data: any) => {
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
            if (modInfo.length > 0) {
                setApp((prevApp: SettingsInterface) => ({
                    ...prevApp,
                    mod: {
                        ...prevApp.mod,
                        ...(prevApp.mod.installed
                            ? { updated: true, version: modInfo[0].modVersion, name: modInfo[0].name }
                            : {
                                  installed: true,
                                  version: modInfo[0].modVersion,
                                  name: modInfo[0].name,
                              }),
                    },
                }))
                if (modInfo[0].showModal || app.settings.showModModalAfterInstall) {
                    store.dispatch(openModal())
                }
                setForceInstallEnabled(false)
                window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS).then((status: any) => {
                    setMusicInstalled(status)
                })
            } else {
                toast.custom('error', t('common.somethingWrongTitle'), t('layout.modInstallUpdateError'))
            }
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
            setIsUpdating(false)
        }

        const handleUpdateAvailable = () => {
            setUpdate(true)
        }

        window.desktopEvents?.on(RendererEvents.DOWNLOAD_PROGRESS, handleProgress)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_SUCCESS, handleSuccess)
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_FAILURE, handleFailure)
        window.desktopEvents?.on(RendererEvents.UPDATE_AVAILABLE, handleUpdateAvailable)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_PROGRESS)
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_SUCCESS)
            window.desktopEvents?.removeAllListeners(RendererEvents.DOWNLOAD_FAILURE)
            window.desktopEvents?.removeAllListeners(RendererEvents.UPDATE_AVAILABLE)
            ;(window as any).__listenersAdded = false
        }
    }, [app.mod.installed, app.settings.showModModalAfterInstall, modInfo, setApp, setMusicInstalled, setUpdate, t])

    useEffect(() => {
        if ((window as any).__musicEventListeners) return
        ;(window as any).__musicEventListeners = true

        const onProgressUpdate = (_: any, { progress }: { progress: number }) => {
            if (toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'loading',
                    title: t('layout.musicDownloadProgress', { progress }),
                    msg: t('layout.downloadProgressLabel'),
                    value: progress,
                })
            } else {
                const id = toast.custom(
                    'loading',
                    t('layout.musicDownloadProgress', { progress }),
                    t('layout.downloadProgressLabel'),
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

        const onExecutionComplete = (_: any, data: any) => {
            if (toastReference.current) {
                toast.custom(
                    'success',
                    t('common.successTitle'),
                    !musicInstalled || !data?.installed ? t('layout.musicInstallSuccess') : t('layout.musicUpdateSuccess'),
                    { id: toastReference.current },
                )
                toastReference.current = null
                setModUpdateState({
                    isVersionOutdated: false,
                    updateUrl: '',
                })
                setIsMusicUpdating(false)
                if (!musicInstalled) {
                    setMusicInstalled(true)
                    window.location.reload()
                } else if (data?.type === 'reinstall') {
                    setApp((prevApp: SettingsInterface) => {
                        const updatedApp = {
                            ...prevApp,
                            mod: {
                                installed: false,
                                version: '',
                            },
                        }
                        window.getModInfo(updatedApp)
                        window.electron.store.delete('mod')
                        return updatedApp
                    })
                    window.location.reload()
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
    }, [musicInstalled, setApp, setMusicInstalled, t])

    useEffect(() => {
        if ((window as any).__ffmpegListenersAdded) return
        ;(window as any).__ffmpegListenersAdded = true

        const handleFfmpegStatus = (_: any, { message, progress, success }: { message: string; progress: number; success?: boolean }) => {
            if (ffmpegToastIdRef.current) {
                if (success) {
                    toast.update(ffmpegToastIdRef.current, {
                        kind: 'success',
                        title: t('layout.ffmpegInstalledTitle'),
                        msg: message,
                        sticky: false,
                        value: undefined,
                    })
                } else if (progress === 100 && !success) {
                    toast.update(ffmpegToastIdRef.current, {
                        kind: 'error',
                        title: t('layout.installErrorTitle'),
                        msg: message,
                        sticky: false,
                        value: undefined,
                    })
                } else {
                    toast.update(ffmpegToastIdRef.current, {
                        title: t('layout.ffmpegInstallProgress', { progress }),
                        msg: message,
                        value: progress,
                    })
                }
            } else {
                if (success) {
                    toast.custom('success', t('layout.ffmpegInstalledTitle'), message)
                } else if (progress === 100 && !success) {
                    toast.custom('error', t('layout.installErrorTitle'), message)
                } else {
                    const id = toast.custom('loading', t('layout.ffmpegInstallProgress', { progress }), message, { duration: Infinity }, progress)
                    ffmpegToastIdRef.current = id
                }
            }
        }

        window.desktopEvents?.on(RendererEvents.FFMPEG_DOWNLOAD_STATUS, handleFfmpegStatus)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.FFMPEG_DOWNLOAD_STATUS)
            ;(window as any).__ffmpegListenersAdded = false
        }
    }, [t])

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
                toast.custom('error', t('common.errorTitle'), t('layout.modNotSupportedOnLinux'))
                return
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

            window.desktopEvents?.send(MainEvents.UPDATE_MUSIC_ASAR, {
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
        [app.mod.installed, isUpdating, modInfo, t],
    )

    useEffect(() => {
        if (!loadingModInfo && !isUpdating && app.mod.installed && app.mod.version) {
            const currentEntry = modInfo.find(m => m.modVersion === app.mod.version)
            if (currentEntry?.deprecated) {
                const availableVersions = modInfo.map(m => m.modVersion).filter(v => semver.valid(v))
                const latestVersion = availableVersions.sort(semver.rcompare)[0]

                if (semver.gt(latestVersion, app.mod.version)) {
                    toast.custom(
                        'info',
                        t('layout.installedVersionOutdated', { version: app.mod.version }),
                        t('layout.newVersionFound', { version: latestVersion }),
                        null,
                        15000,
                    )
                    startUpdate()
                }
            }
        }
    }, [app.mod.version, isUpdating, loadingModInfo, modInfo, startUpdate, t])

    useEffect(() => {
        if (isDevmark) {
            document.body.style.border = '3px solid #fff34c'
            document.body.style.borderRadius = '10px'
        } else {
            document.body.style.border = ''
            document.body.style.borderRadius = ''
        }
        return () => {
            document.body.style.border = ''
            document.body.style.borderRadius = ''
        }
    }, [isDevmark])

    if (loadingModInfo) {
        return <Preloader />
    }

    return (
        <HelmetProvider>
            <Helmet>
                <title>{title + ' - PulseSync'}</title>
            </Helmet>
            <div className={pageStyles.children}>
                <Header goBack={goBack} />
                <div className={pageStyles.main_window} style={isDevmark ? { bottom: '20px' } : {}}>
                    <div className={pageStyles.navigation_bar}>
                        <div className={pageStyles.navigation_buttons}>
                            <NavButtonPulse to="/" text={t('layout.nav.trackInfo')}>
                                <DiscordIcon height={24} width={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/extension" text={t('layout.nav.addonsBeta')} disabled={!musicInstalled}>
                                <MdPower size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/users" text={t('layout.nav.users')} disabled={!features?.usersPage || !musicInstalled}>
                                <MdPeople size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/store" text={t('layout.nav.extensionsStore')} disabled={!features?.storePage || !musicInstalled}>
                                <MdStoreMallDirectory size={24} />
                            </NavButtonPulse>
                        </div>
                        <div className={clsx(pageStyles.navigation_buttons, pageStyles.alert_fix)}>
                            {isDev && (
                                <NavButtonPulse to="/dev" text={t('layout.nav.development')}>
                                    <MdHandyman size={24} />
                                </NavButtonPulse>
                            )}
                            {updateAvailable && (
                                <TooltipButton tooltipText={t('layout.installUpdateTooltip')} as={'div'}>
                                    <button
                                        onClick={() => {
                                            setUpdate(false)
                                            window.desktopEvents?.send(MainEvents.UPDATE_INSTALL)
                                        }}
                                        className={pageStyles.update_download}
                                    >
                                        <MdDownload size={24} />
                                    </button>
                                </TooltipButton>
                            )}
                        </div>
                    </div>
                    {isModUpdateAvailable && (
                        <div className={pageStyles.alert_patch}>
                            <div className={pageStyles.patch_container}>
                                <div className={pageStyles.patch_detail}>
                                    <div className={pageStyles.alert_info}>
                                        <div className={pageStyles.alert_version_update}>
                                            <div className={pageStyles.version_old}>
                                                {app.mod.version && app.mod.installed ? app.mod.version : t('layout.modNotInstalled')}
                                            </div>
                                            <MdKeyboardArrowRight size={14} />
                                            <div className={pageStyles.version_new}>{modInfo[0]?.modVersion}</div>
                                        </div>
                                        <div className={pageStyles.alert_title}>
                                            {app.mod.installed && app.mod.version ? t('layout.modUpdateTitle') : t('layout.modInstallTitle')}
                                        </div>
                                        <div className={pageStyles.alert_warn}>{t('layout.closeMusicWarning')}</div>
                                    </div>
                                    <div className={pageStyles.button_container}>
                                        <button className={pageStyles.patch_button} onClick={() => startUpdate()}>
                                            <MdUpdate size={20} />
                                            {app.mod.installed && app.mod.version ? t('layout.updateAction') : t('layout.installAction')}
                                        </button>
                                        {isForceInstallEnabled && !modUpdateState.isVersionOutdated && (
                                            <button className={pageStyles.patch_button} onClick={() => startUpdate(true)}>
                                                <MdOutlineWarningAmber size={20} />
                                                {app.mod.installed ? t('layout.forceUpdateAction') : t('layout.forceInstallAction')}
                                            </button>
                                        )}
                                        {modUpdateState.isVersionOutdated && (
                                            <button className={pageStyles.patch_button} onClick={() => updateYandexMusic()}>
                                                <MdOutlineInstallDesktop size={20} />
                                                {t('layout.updateMusicAction')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <img
                                    className={pageStyles.alert_patch_image}
                                    src={staticAsset('assets/images/imageAlertPatch.png')}
                                    alt={t('layout.patchUpdateAlt')}
                                />
                            </div>
                        </div>
                    )}
                    {children}
                </div>
            </div>
        </HelmetProvider>
    )
}

export default Layout
