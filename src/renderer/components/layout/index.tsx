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
import DiscordIcon from '../../assets/icons/discord.svg'
import Preloader from '../preloader'
import userContext from '../../api/context/user'
import SettingsInterface from '../../api/interfaces/settings.interface'
import toast from '../toast'
import * as pageStyles from './layout.module.scss'
import { isDev, isDevmark } from '@common/appConfig'
import TooltipButton from '../tooltip_button'
import { useModalContext } from '../../api/context/modal'
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
    const { user, app, setApp, updateAvailable, setUpdate, modInfo, modInfoFetched, features, musicInstalled, setMusicInstalled, setMusicVersion } =
        useContext(userContext)
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()

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

    const isUserDeveloper = useCallback(() => {
        return user?.perms === 'developer' || isDev
    }, [user])

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

        const handleProgress = (_: any, { progress, name }: { progress: number, name: string }) => {
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
                    openModal(Modals.MOD_CHANGELOG)
                }
                setForceInstallEnabled(false)
                Promise.all([
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS),
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_VERSION),
                ]).then(([status, version]) => {
                    setMusicInstalled(Boolean(status))
                    setMusicVersion(version ?? null)
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
            if (error.type === 'linux_permissions_required' && window.electron.isLinux()) {
                openModal(Modals.LINUX_PERMISSIONS_MODAL)
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
        Modals.LINUX_PERMISSIONS_MODAL,
        Modals.MOD_CHANGELOG,
        modInfo,
        openModal,
        setApp,
        setMusicInstalled,
        setMusicVersion,
        setUpdate,
        t,
    ])

    useEffect(() => {
        if ((window as any).__musicEventListeners) return
        ;(window as any).__musicEventListeners = true

        const onProgressUpdate = (_: any, { progress }: { progress: number }) => {
            if (toastReference.current) {
                toast.update(toastReference.current, {
                    kind: 'loading',
                    title: t('layout.downloadProgressLabel'),
                    msg: t('layout.downloading'),
                    value: progress,
                })
            } else {
                const id = toast.custom(
                    'loading',
                    t('layout.downloadProgressLabel'),
                    t('layout.downloading'),
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
                setModUpdateState({
                    isVersionOutdated: false,
                    updateUrl: '',
                })
                setIsMusicUpdating(false)
                const [status, version] = await Promise.all([
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_STATUS),
                    window.desktopEvents?.invoke(MainEvents.GET_MUSIC_VERSION),
                ])
                setMusicInstalled(Boolean(status))
                setMusicVersion(version ?? null)
                if (data?.type === 'reinstall') {
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
                    openModal(Modals.LINUX_ASAR_PATH)
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
        [app.mod.installed, isUpdating, Modals.LINUX_ASAR_PATH, modInfo, openModal, t],
    )

    useEffect(() => {
        if (!modInfoFetched || modInfo.length === 0 || isUpdating || !app.mod.installed || !app.mod.version) return
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
    }, [app.mod.version, isUpdating, modInfo, modInfoFetched, startUpdate, t])

    useEffect(() => {
        if (isDevmark) {
            document.body.classList.add('devmark-border')
        } else {
            document.body.classList.remove('devmark-border')
        }
        return () => {
            document.body.classList.remove('devmark-border')
        }
    }, [isDevmark])

    if (!modInfoFetched) {
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
                            {isUserDeveloper() && (
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
                                        <div className={pageStyles.alert_title}>
                                            {app.mod.installed && app.mod.version ? t('layout.modUpdateTitle') : t('layout.modInstallTitle')}
                                        </div>
                                        <div className={pageStyles.alert_warn}>{t('layout.modInstallDescription')}</div>
                                        <div className={pageStyles.alert_version_update}>
                                            <div className={pageStyles.version_old}>
                                                {app.mod.version && app.mod.installed ? app.mod.version : t('layout.modNotInstalled')}
                                            </div>
                                            <MdKeyboardArrowRight size={14} />
                                            <div className={pageStyles.version_new}>{modInfo[0]?.modVersion}</div>
                                        </div>
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
