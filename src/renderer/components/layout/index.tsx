import React, { useContext, useEffect, useRef, useState } from 'react'
import { Helmet, HelmetProvider } from '@dr.pogodin/react-helmet'
import {
    MdDownload,
    MdExtension,
    MdHandyman,
    MdKeyboardArrowRight,
    MdOutlineInstallDesktop,
    MdOutlineWarningAmber,
    MdPeople,
    MdStoreMallDirectory,
    MdUpdate,
} from 'react-icons/md'
import Header from './header'
import NavButtonPulse from '../nav_button_pulse'
import DiscordIcon from './../../../../static/assets/icons/discord.svg'
import Preloader from '../preloader'
import userContext from '../../api/context/user.context'
import SettingsInterface from '../../api/interfaces/settings.interface'
import toast from '../toast'
import * as pageStyles from './layout.module.scss'
import { isDev, isDevmark } from '../../api/config'
import TooltipButton from '../tooltip_button'
import store from '../../api/store/store'
import { openModal } from '../../api/store/modalSlice'
import { errorTypesToShow } from '../../utils/utils'
import * as semver from 'semver'

interface LayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, modInfo, features, musicInstalled, setMusicInstalled } = useContext(userContext)

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

    const clean = (version: string) => semver.valid(String(version ?? '').trim()) ?? '0.0.0'

    useEffect(() => {
        setLoadingModInfo(modInfo.length === 0)
    }, [modInfo])

    useEffect(() => {
        const serverRaw = modInfo[0]?.modVersion
        if (!serverRaw) return

        const serverVer = clean(serverRaw)
        const localVer = clean(app.mod?.version)

        setIsModUpdateAvailable(musicInstalled && (!app.mod.installed || semver.gt(serverVer, localVer)))
    }, [app.mod.installed, app.mod.version, modInfo, musicInstalled])

    useEffect(() => {
        if ((window as any).__listenersAdded) return
        ;(window as any).__listenersAdded = true

        const handleProgress = (_: any, { progress }: { progress: number }) => {
            if (downloadToastIdRef.current) {
                toast.custom(
                    'loading',
                    `Прогресс загрузки: ${progress}%`,
                    `Загружаю`,
                    { id: downloadToastIdRef.current, duration: Infinity },
                    progress,
                )
            } else {
                const id = toast.custom('loading', `Прогресс загрузки: ${progress}%`, `Загружаю`, { duration: Infinity }, progress)
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = (_: any, data: any) => {
            if (downloadToastIdRef.current) {
                toast.custom('success', data.message || (app.mod.installed ? 'Обновление прошло успешно!' : 'Установка прошла успешно!'), `Готово`, {
                    id: downloadToastIdRef.current,
                })
                downloadToastIdRef.current = null
            } else {
                toast.custom('success', data.message || (app.mod.installed ? 'Обновление прошло успешно!' : 'Установка прошла успешно!'), `Готово`)
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
                window.desktopEvents?.invoke('getMusicStatus').then((status: any) => {
                    setMusicInstalled(status)
                })
            } else {
                toast.custom('error', 'Что-то не так', 'Ошибка установки/обновления')
            }
            setIsUpdating(false)
        }

        const handleFailure = (_: any, error: any) => {
            const getErrorMessage = () => {
                if (errorTypesToShow.has(error.type)) {
                    return `Ошибка: ${error.error || 'Неизвестная ошибка.'}`
                }
                return app.mod.installed
                    ? `Не удалось обновить мод. Попробуйте ещё раз или проверьте соединение.`
                    : `Установка мода не удалась. Попробуйте ещё раз.`
            }

            if (downloadToastIdRef.current) {
                toast.custom('error', 'Произошла ошибка', getErrorMessage(), { id: downloadToastIdRef.current })
                downloadToastIdRef.current = null
            } else {
                toast.custom('error', 'Произошла ошибка', getErrorMessage())
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

        window.desktopEvents?.on('download-progress', handleProgress)
        window.desktopEvents?.on('download-success', handleSuccess)
        window.desktopEvents?.on('download-failure', handleFailure)
        window.desktopEvents?.on('update-available', handleUpdateAvailable)

        return () => {
            window.desktopEvents?.removeAllListeners('download-progress')
            window.desktopEvents?.removeAllListeners('download-success')
            window.desktopEvents?.removeAllListeners('download-failure')
            window.desktopEvents?.removeAllListeners('update-available')
            ;(window as any).__listenersAdded = false
        }
    }, [modInfo, app.mod.installed, app.settings.showModModalAfterInstall])

    useEffect(() => {
        if ((window as any).__musicEventListeners) return
        ;(window as any).__musicEventListeners = true

        const onProgressUpdate = (_: any, { progress }: { progress: number }) => {
            if (toastReference.current) {
                toast.custom('loading', `Загрузка: ${progress}%`, 'Прогресс загрузки', { id: toastReference.current, duration: Infinity }, progress)
            } else {
                const id = toast.custom('loading', `Загрузка: ${progress}%`, 'Прогресс загрузки', { duration: Infinity }, progress)
                toastReference.current = id
            }
        }

        const onUpdateFailure = (_: any, error: any) => {
            if (toastReference.current) {
                toast.custom(
                    'error',
                    `Ошибка: ${error.error}`,
                    !musicInstalled ? 'Не удалось выполнить установку Я.Музыки' : 'Не удалось выполнить обновление Я.Музыки',
                    { id: toastReference.current },
                )
                toastReference.current = null
            } else {
                toast.custom(
                    'error',
                    `Ошибка: ${error.error}`,
                    !musicInstalled ? 'Не удалось выполнить установку Я.Музыки' : 'Не удалось выполнить обновление Я.Музыки',
                )
            }
            setIsMusicUpdating(false)
        }

        const onExecutionComplete = (_: any, data: any) => {
            if (toastReference.current) {
                toast.custom(
                    'success',
                    'Успешно!',
                    !musicInstalled || !data?.installed ? 'Установка Я.Музыки прошла успешно.' : 'Обновление Я.Музыки прошло успешно.',
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

        window.desktopEvents?.on('download-music-progress', onProgressUpdate)
        window.desktopEvents?.on('download-music-failure', onUpdateFailure)
        window.desktopEvents?.on('download-music-execution-success', onExecutionComplete)

        return () => {
            window.desktopEvents?.removeAllListeners('download-music-progress')
            window.desktopEvents?.removeAllListeners('download-music-failure')
            window.desktopEvents?.removeAllListeners('download-music-execution-success')
            ;(window as any).__musicEventListeners = false
        }
    }, [musicInstalled])

    useEffect(() => {
        if ((window as any).__ffmpegListenersAdded) return
        ;(window as any).__ffmpegListenersAdded = true

        const handleFfmpegStatus = (_: any, { message, progress, success }: { message: string; progress: number; success?: boolean }) => {
            if (ffmpegToastIdRef.current) {
                if (success) {
                    toast.custom('success', message, 'Готово', { id: ffmpegToastIdRef.current })
                    ffmpegToastIdRef.current = null
                } else {
                    toast.custom('loading', `Установка ffmpeg: ${progress}%`, message, { id: ffmpegToastIdRef.current, duration: Infinity }, progress)
                }
            } else {
                if (success) {
                    toast.custom('success', message, 'Готово')
                } else {
                    const id = toast.custom('loading', `Установка ffmpeg: ${progress}%`, message, { duration: Infinity }, progress)
                    ffmpegToastIdRef.current = id
                }
            }
        }

        window.desktopEvents?.on('ffmpeg-download-status', handleFfmpegStatus)

        return () => {
            window.desktopEvents?.removeAllListeners('ffmpeg-download-status')
            ;(window as any).__ffmpegListenersAdded = false
        }
    }, [])

    const updateYandexMusic = () => {
        if (isMusicUpdating) {
            toast.custom('info', `Информация.`, 'Обновление уже запущено')
            return
        }
        window.desktopEvents?.send('download-yandex-music', modUpdateState.updateUrl)
        setIsMusicUpdating(true)
    }

    const startUpdate = (force?: boolean) => {
        if (isUpdating) {
            toast.custom('error', 'Ошибка', app.mod.installed ? 'Обновление уже запущено' : 'Установка уже запущена')
            return
        }
        if (modInfo.length === 0) {
            toast.custom(
                'error',
                app.mod.installed ? 'Нет доступных обновлений для установки.' : 'Нет доступных модификаций для установки.',
                app.mod.installed ? 'Ошибка загрузки обновления' : 'Ошибка установки мода',
            )
            return
        }
        setIsUpdating(true)
        const id = toast.custom('loading', app.mod.installed ? 'Начало загрузки обновления...' : 'Начало установки мода...', 'Ожидайте...')
        downloadToastIdRef.current = id
        const { modVersion, downloadUrl, checksum, spoof, name, shouldReinstall } = modInfo[0]
        console.log(modInfo[0])
        window.desktopEvents?.send('update-music-asar', {
            version: modVersion,
            name,
            link: downloadUrl,
            checksum,
            shouldReinstall,
            force: force || false,
            spoof: spoof || false,
        })
    }

    useEffect(() => {
        if (!loadingModInfo && !isUpdating && app.mod.installed && app.mod.version) {
            const currentEntry = modInfo.find(m => m.modVersion === app.mod.version)
            if (currentEntry?.deprecated) {
                const availableVersions = modInfo.map(m => m.modVersion).filter(v => semver.valid(v))
                const latestVersion = availableVersions.sort(semver.rcompare)[0]

                if (semver.gt(latestVersion, app.mod.version)) {
                    toast.custom(
                        'info',
                        `Установленная версия (${app.mod.version}) устарела`,
                        `Найдена новая версия ${latestVersion}. Выполняю автообновление...`,
                        null,
                        15000,
                    )
                    startUpdate()
                }
            }
        }
    }, [loadingModInfo, modInfo, app.mod.version, isUpdating])

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
                            <NavButtonPulse to="/trackinfo" text="Информация о треке">
                                <DiscordIcon height={24} width={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/extensionbeta" text="Аддоны Бета" disabled={!musicInstalled}>
                                <MdExtension size={24} />
                                <div className={pageStyles.betatest}>beta</div>
                            </NavButtonPulse>
                            <NavButtonPulse to="/users" text="Пользователи" disabled={!features?.usersPage || !musicInstalled}>
                                <MdPeople size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/store" text="Магазин расширений" disabled={!features?.storePage || !musicInstalled}>
                                <MdStoreMallDirectory size={24} />
                            </NavButtonPulse>
                        </div>
                        <div className={pageStyles.navigation_buttons}>
                            {isDev && (
                                <NavButtonPulse to="/dev" text="Development">
                                    <MdHandyman size={24} />
                                </NavButtonPulse>
                            )}
                            {updateAvailable && (
                                <TooltipButton tooltipText="Установить обновление" as={'div'}>
                                    <button
                                        onClick={() => {
                                            if (window.electron.isMac()) {
                                                toast.custom('error', 'Ошибка', 'Обновление внутри приложения доступно только для Windows и Linux')
                                                return
                                            }
                                            setUpdate(false)
                                            window.desktopEvents?.send('update-install')
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
                                                {app.mod.version && app.mod.installed ? app.mod.version : 'Не установлен'}
                                            </div>
                                            <MdKeyboardArrowRight size={14} />
                                            <div className={pageStyles.version_new}>{modInfo[0]?.modVersion}</div>
                                        </div>
                                        <div className={pageStyles.alert_title}>
                                            {app.mod.installed && app.mod.version ? 'Обновление мода' : 'Установка мода'}
                                        </div>
                                        <div className={pageStyles.alert_warn}>Убедитесь, что Яндекс Музыка закрыта!</div>
                                    </div>
                                    <div className={pageStyles.button_container}>
                                        <button className={pageStyles.patch_button} onClick={() => startUpdate()}>
                                            <MdUpdate size={20} />
                                            {app.mod.installed && app.mod.version ? 'Обновить' : 'Установить'}
                                        </button>
                                        {isForceInstallEnabled && !modUpdateState.isVersionOutdated && (
                                            <button className={pageStyles.patch_button} onClick={() => startUpdate(true)}>
                                                <MdOutlineWarningAmber size={20} />
                                                {app.mod.installed ? 'Все равно обновить' : 'Все равно установить'}
                                            </button>
                                        )}
                                        {modUpdateState.isVersionOutdated && (
                                            <button className={pageStyles.patch_button} onClick={() => updateYandexMusic()}>
                                                <MdOutlineInstallDesktop size={20} />
                                                Обновить Яндекс.Музыку
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <img className={pageStyles.alert_patch_image} src="static/assets/images/imageAlertPatch.png" alt="Patch Update" />
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
