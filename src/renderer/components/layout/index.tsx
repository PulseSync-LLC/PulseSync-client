import React, { useContext, useEffect, useRef, useState } from 'react'
import { Helmet, HelmetProvider } from '@dr.pogodin/react-helmet'
import {
    MdDownload,
    MdExtension,
    MdHandyman,
    MdKeyboardArrowRight,
    MdOutlineWarningAmber,
    MdOutlineInstallDesktop,
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

interface LayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, modInfo, features } = useContext(userContext)
    const [isUpdating, setIsUpdating] = useState(false)
    const [isMusicUpdating, setIsMusicUpdating] = useState(false)
    const [loadingModInfo, setLoadingModInfo] = useState(true)
    const [isForceInstallEnabled, setForceInstallEnabled] = useState(false)
    const [modUpdateState, setModUpdateState] = useState({
        isVersionOutdated: false,
        updateUrl: '',
    })
    const downloadToastIdRef = useRef<string | null>(null)
    const toastReference = useRef<string | null>(null)

    useEffect(() => {
        if (modInfo.length > 0) {
            setLoadingModInfo(false)
        } else {
            setLoadingModInfo(false)
        }
    }, [modInfo])

    useEffect(() => {
        const isListenersAdded = (window as any).__listenersAdded
        if (isListenersAdded) {
            return
        }
        ;(window as any).__listenersAdded = true

        const handleProgress = (event: any, { progress }: { progress: number }) => {
            if (downloadToastIdRef.current) {
                toast.custom(
                    'loading',
                    `Прогресс загрузки: ${progress}%`,
                    `Загружаю`,
                    {
                        id: downloadToastIdRef.current,
                        duration: Infinity,
                    },
                    progress,
                )
            } else {
                const id = toast.custom(
                    'loading',
                    `Прогресс загрузки: ${progress}%`,
                    `Загружаю`,
                    {
                        duration: Infinity,
                    },
                    progress,
                )
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = (event: any, data: any) => {
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
                            ? { updated: true, version: modInfo[0].modVersion }
                            : {
                                  installed: true,
                                  version: modInfo[0].modVersion,
                              }),
                    },
                }))
                if (modInfo[0].showModal || app.settings.showModModalAfterInstall) {
                    store.dispatch(openModal())
                }
                setForceInstallEnabled(false)
            } else {
                toast.custom('error', 'Что-то не так', 'Ошибка обновления')
            }

            setIsUpdating(false)
        }

        const handleFailure = (event: any, error: any) => {
            if (downloadToastIdRef.current) {
                toast.custom(
                    'error',
                    'Произошла ошибка',
                    `${
                        ['version_too_new', 'version_outdated', 'checksum_mismatch'].includes(error.type)
                            ? `Ошибка: ${error.error || 'Неизвестная ошибка.'}`
                            : app.mod.installed
                              ? `Не удалось обновить мод. Попробуйте ещё раз или проверьте соединение.`
                              : `Установка мода не удалась. Попробуйте ещё раз.`
                    }`,
                    {
                        id: downloadToastIdRef.current,
                    },
                )
                downloadToastIdRef.current = null
            } else {
                toast.custom(
                    'error',
                    'Произошла ошибка',
                    `${
                        ['version_too_new', 'version_outdated', 'checksum_mismatch'].includes(error.type)
                            ? `Ошибка: ${error.error || 'Неизвестная ошибка.'}`
                            : app.mod.installed
                              ? `Не удалось обновить мод. Попробуйте ещё раз или проверьте соединение.`
                              : `Установка мода не удалась. Попробуйте ещё раз.`
                    }`,
                )
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

        const handleUpdateAvailable = (event: any, data: any) => {
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
    }, [modInfo])

    useEffect(() => {
        const isListenersAttached = (window as any).__musicEventListeners
        if (isListenersAttached) return
        ;(window as any).__musicEventListeners = true

        const onProgressUpdate = (event: any, { progress }: { progress: number }) => {
            if (toastReference.current) {
                toast.custom('loading', `Загрузка: ${progress}%`, 'Процесс обновления', { id: toastReference.current, duration: Infinity }, progress)
            } else {
                const toastId = toast.custom('loading', `Загрузка: ${progress}%`, 'Процесс обновления', { duration: Infinity }, progress)
                toastReference.current = toastId
            }
        }

        const onUpdateFailure = (event: any, error: any) => {
            if (toastReference.current) {
                toast.custom('error', `Ошибка: ${error.error}`, 'Не удалось выполнить обновление', {
                    id: toastReference.current,
                })
                toastReference.current = null
            } else {
                toast.custom('error', `Ошибка: ${error.error}`, 'Не удалось выполнить обновление')
            }
            setIsMusicUpdating(false)
        }

        const onExecutionComplete = (event: any, data: any) => {
            if (toastReference.current) {
                toast.custom('success', 'Успешно!', 'Обновление Я.Музыки прошло успешно.', {
                    id: toastReference.current,
                })
                toastReference.current = null
                setModUpdateState({
                    isVersionOutdated: false,
                    updateUrl: '',
                })
                setIsMusicUpdating(false)
            }
        }

        window.desktopEvents?.on('update-music-progress', onProgressUpdate)
        window.desktopEvents?.on('update-music-failure', onUpdateFailure)
        window.desktopEvents?.on('update-music-execution-success', onExecutionComplete)

        return () => {
            window.desktopEvents?.removeAllListeners('update-music-progress')
            window.desktopEvents?.removeAllListeners('update-music-failure')
            window.desktopEvents?.removeAllListeners('update-music-execution-success')
            ;(window as any).__musicEventListeners = false
        }
    }, [])

    const updateYandexMusic = () => {
        if (isMusicUpdating) {
            toast.custom('info', `Обновление уже запущено.`, 'Информация')
            return
        }
        window.desktopEvents?.send('update-yandex-music', modUpdateState.updateUrl)
        setIsMusicUpdating(true)
    }
    const startUpdate = (force?: boolean) => {
        if (isUpdating) {
            toast.custom('info', `Обновление уже запущено.`, 'Информация')
            return
        }

        if (modInfo.length === 0) {
            toast.custom('error', `Нет доступных обновлений для установки.`, 'Ошибка загрузки обновления')
            return
        }

        setIsUpdating(true)

        const id = toast.custom('loading', 'Начало загрузки обновления...', 'Ожидайте...')

        downloadToastIdRef.current = id

        const { modVersion, downloadUrl, checksum, spoof } = modInfo[0]

        window.desktopEvents?.send('update-app-asar', {
            version: modVersion,
            link: downloadUrl,
            checksum,
            force: force || false,
            spoof: spoof || false,
        })
    }

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
                <div
                    className={pageStyles.main_window}
                    style={
                        isDevmark
                            ? {
                                  bottom: '20px',
                              }
                            : {}
                    }
                >
                    <div className={pageStyles.navigation_bar}>
                        <div className={pageStyles.navigation_buttons}>
                            <NavButtonPulse to="/trackinfo" text="Track Info">
                                <DiscordIcon height={24} width={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/extensionbeta" text="Extension Beta">
                                <MdExtension size={24} />
                                <div className={pageStyles.betatest}>beta</div>
                            </NavButtonPulse>
                            <NavButtonPulse to="/users" text="Users" disabled={!features.usersPage}>
                                <MdPeople size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/store" text="Store" disabled={!features.storePage}>
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
                                <TooltipButton tooltipText="Install Update" as={'div'}>
                                    <button
                                        onClick={() => {
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
                    {modInfo.length > 0 && (!app.mod.installed || app.mod.version < modInfo[0]?.modVersion) && (
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
