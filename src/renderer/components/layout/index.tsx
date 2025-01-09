import React, { useContext, useEffect, useRef, useState } from 'react'
import { Helmet, HelmetProvider } from 'react-helmet-async'
import {
    MdDownload,
    MdExtension,
    MdHandyman,
    MdKeyboardArrowRight,
    MdOutlineWarningAmber,
    MdPeople,
    MdStoreMallDirectory,
    MdUpdate,
} from 'react-icons/md'

import OldHeader from './old_header'
import NavButtonPulse from '../nav_button_pulse'
import DiscordIcon from './../../../../static/assets/icons/discord.svg'
import Preloader from '../preloader'

import userContext from '../../api/context/user.context'
import SettingsInterface from '../../api/interfaces/settings.interface'
import toast from '../toast'
import * as pageStyles from './layout.module.scss'
import { isDev, isDevmark } from '../../api/config'
import TooltipButton from '../tooltip_button'

interface LayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, modInfo } =
        useContext(userContext)
    const [isUpdating, setIsUpdating] = useState(false)
    const [loadingPatchInfo, setLoadingPatchInfo] = useState(true)
    const [isForceInstallEnabled, setForceInstallEnabled] = useState(false)
    const downloadToastIdRef = useRef<string | null>(null)

    useEffect(() => {
        if (modInfo.length > 0) {
            setLoadingPatchInfo(false)
        } else {
            setLoadingPatchInfo(false)
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
                toast.custom('loading', `Прогресс загрузки: ${progress}%`, `Загружаю`, {
                    id: downloadToastIdRef.current,
                    duration: Infinity,
                }, progress)
            } else {
                const id = toast.custom('loading', `Прогресс загрузки: ${progress}%`, `Загружаю`, {
                    duration: Infinity,
                }, progress)
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = (event: any, data: any) => {
            if (downloadToastIdRef.current) {
                toast.custom('success', `Обновление прошло успешно`, `Готово`, {
                    id: downloadToastIdRef.current,
                })
                downloadToastIdRef.current = null
            }
            // toast.success(
            //     data.message ||
            //         (app.mod.installed
            //             ? 'Обновление прошло успешно!'
            //             : 'Установка прошла успешно!'),
            //     {
            //         style: {
            //             background: '#292C36',
            //             color: '#ffffff',
            //             border: 'solid 1px #363944',
            //             borderRadius: '8px',
            //         },
            //     },
            // )

            if (modInfo.length > 0) {
                setApp((prevApp: SettingsInterface) => ({
                    ...prevApp,
                    mod: {
                        ...prevApp.mod,
                        installed: true,
                        version: modInfo[0].modVersion,
                    },
                }))
                setForceInstallEnabled(false)
            } else {
                toast.custom('error', 'Что-то не так', 'Ошибка обновления')
            }

            setIsUpdating(false)
        }

        const handleFailure = (event: any, error: any) => {
            if (downloadToastIdRef.current) {
                // toast.dismiss(downloadToastIdRef.current)
                toast.custom(
                    'error',
                    `Что-то не так`,
                    `Ошибка обновления: ${error.error}`,
                    {
                        id: downloadToastIdRef.current,
                    },
                )
                downloadToastIdRef.current = null
            }
            toast.custom(
                'error',
                `Что-то не так`,
                `${
                    app.mod.installed
                        ? 'Обновление не удалось'
                        : 'Установка не удалась!'
                }: ${error.error}`,
                {
                    id: downloadToastIdRef.current,
                },
            )
            if (error.type === 'version_mismatch') {
                setForceInstallEnabled(true)
            }
            setIsUpdating(false)
        }

        const handleUpdateAvailable = (event: any, data: any) => {
            setUpdate(true)
        }

        window.desktopEvents?.on('download-progress', handleProgress)
        window.desktopEvents?.on('update-success', handleSuccess)
        window.desktopEvents?.on('update-failure', handleFailure)
        window.desktopEvents?.on('update-available', handleUpdateAvailable)

        return () => {
            window.desktopEvents?.removeAllListeners('download-progress')
            window.desktopEvents?.removeAllListeners('update-success')
            window.desktopEvents?.removeAllListeners('update-failure')
            window.desktopEvents?.removeAllListeners('update-available')
            ;(window as any).__listenersAdded = false
        }
    }, [modInfo])

    const startUpdate = (force?: boolean) => {
        if (isUpdating) {
            toast.custom('info', `Обновление уже запущено.`, 'Информация')
            return
        }

        if (modInfo.length === 0) {
            toast.custom(
                'error',
                `Нет доступных обновлений для установки.`,
                'Ошибка загрузки обновления',
            )
            return
        }

        setIsUpdating(true)

        const id = toast.custom(
            'loading',
            'Начало загрузки обновления...',
            'Ожидайте...',
        )

        downloadToastIdRef.current = id

        const { modVersion, downloadUrl, checksum } = modInfo[0]
        window.desktopEvents?.send('update-app-asar', {
            version: modVersion,
            link: downloadUrl,
            checksum,
            force: force || false,
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

    if (loadingPatchInfo) {
        return <Preloader />
    }

    return (
        <HelmetProvider>
            <Helmet>
                <title>{title + ' - PulseSync'}</title>
            </Helmet>
            <div className={pageStyles.children}>
                <OldHeader goBack={goBack} />
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
                            <TooltipButton tooltipText="Track Info" as={'div'}>
                                <NavButtonPulse to="/trackinfo">
                                    <DiscordIcon height={24} width={24} />
                                </NavButtonPulse>
                            </TooltipButton>

                            <TooltipButton tooltipText="Extension Beta" as={'div'}>
                                <NavButtonPulse to="/extensionbeta">
                                    <MdExtension size={24} />
                                    <div className={pageStyles.betatest}>beta</div>
                                </NavButtonPulse>
                            </TooltipButton>

                            <TooltipButton tooltipText="Users" as={'div'}>
                                <NavButtonPulse to="/users">
                                    <MdPeople size={24} />
                                </NavButtonPulse>
                            </TooltipButton>

                            <TooltipButton
                                tooltipText="Store"
                                as="div"
                                className={pageStyles.disabled}
                            >
                                <NavButtonPulse to="/store" disabled>
                                    <MdStoreMallDirectory size={24} />
                                </NavButtonPulse>
                            </TooltipButton>
                        </div>
                        <div className={pageStyles.navigation_buttons}>
                            {isDev && (
                                <TooltipButton tooltipText="Development" as={'div'}>
                                    <NavButtonPulse to="/dev">
                                        <MdHandyman size={24} />
                                    </NavButtonPulse>
                                </TooltipButton>
                            )}
                            {updateAvailable && (
                                <TooltipButton
                                    tooltipText="Install Update"
                                    as={'div'}
                                >
                                    <button
                                        onClick={() => {
                                            setUpdate(false)
                                            window.desktopEvents?.send(
                                                'update-install',
                                            )
                                        }}
                                        className={pageStyles.update_download}
                                    >
                                        <MdDownload size={24} />
                                    </button>
                                </TooltipButton>
                            )}
                        </div>
                    </div>
                    {modInfo.length > 0 &&
                        (!app.mod.installed ||
                            app.mod.version < modInfo[0]?.modVersion) && (
                            <div className={pageStyles.alert_patch}>
                                <div className={pageStyles.patch_container}>
                                    <div className={pageStyles.patch_detail}>
                                        <div className={pageStyles.alert_info}>
                                            <div
                                                className={
                                                    pageStyles.alert_version_update
                                                }
                                            >
                                                <div
                                                    className={
                                                        pageStyles.version_old
                                                    }
                                                >
                                                    {app.mod.version &&
                                                    app.mod.installed
                                                        ? app.mod.version
                                                        : 'Не установлен'}
                                                </div>
                                                <MdKeyboardArrowRight size={14} />
                                                <div
                                                    className={
                                                        pageStyles.version_new
                                                    }
                                                >
                                                    {modInfo[0]?.modVersion}
                                                </div>
                                            </div>
                                            <div className={pageStyles.alert_title}>
                                                {app.mod.installed
                                                    ? 'Обновление мода'
                                                    : 'Установка мода'}
                                            </div>
                                            <div className={pageStyles.alert_warn}>
                                                Убедитесь, что Яндекс Музыка закрыта!
                                            </div>
                                        </div>
                                        <div className={pageStyles.button_container}>
                                            <button
                                                className={pageStyles.patch_button}
                                                onClick={() => startUpdate()}
                                            >
                                                <MdUpdate size={20} />
                                                {app.mod.installed
                                                    ? 'Обновить'
                                                    : 'Установить'}
                                            </button>
                                            {isForceInstallEnabled && (
                                                <button
                                                    className={
                                                        pageStyles.patch_button
                                                    }
                                                    onClick={() => startUpdate(true)}
                                                >
                                                    <MdOutlineWarningAmber
                                                        size={20}
                                                    />
                                                    {app.mod.installed
                                                        ? 'Все равно обновить'
                                                        : 'Все равно установить'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <img
                                        className={pageStyles.alert_patch_image}
                                        src="static/assets/images/imageAlertPatch.png"
                                        alt="Patch Update"
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
