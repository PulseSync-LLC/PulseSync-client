import React, { useContext, useEffect, useRef, useState } from 'react'
import { Helmet } from 'react-helmet'
import {
    MdConnectWithoutContact,
    MdDownload,
    MdExtension,
    MdKeyboardArrowRight,
    MdStoreMallDirectory,
    MdUpdate,
} from 'react-icons/md'

import OldHeader from './old_header'
import NavButtonPulse from '../nav_button_pulse'
import DiscordIcon from './../../../../static/assets/icons/discord.svg'
import Preloader from '../preloader'

import userContext from '../../api/context/user.context'
import SettingsInterface from '../../api/interfaces/settings.interface'
import { Toaster, toast } from 'react-hot-toast-magic'
import * as pageStyles from './layout.module.scss'

interface LayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, patcherInfo } =
        useContext(userContext)
    const [isUpdating, setIsUpdating] = useState(false)
    const [loadingPatchInfo, setLoadingPatchInfo] = useState(true)
    const downloadToastIdRef = useRef<string | null>(null)

    useEffect(() => {
        if (patcherInfo.length > 0) {
            setLoadingPatchInfo(false)
        } else {
            setLoadingPatchInfo(false)
        }
    }, [patcherInfo])

    useEffect(() => {
        const isListenersAdded = (window as any).__listenersAdded
        if (isListenersAdded) {
            return
        }
        ;(window as any).__listenersAdded = true

        const handleProgress = (event: any, { progress }: { progress: number }) => {
            if (downloadToastIdRef.current) {
                toast.loading(`Прогресс загрузки: ${progress}%`, {
                    id: downloadToastIdRef.current,
                    style: {
                        background: '#292C36',
                        color: '#ffffff',
                        border: 'solid 1px #363944',
                        borderRadius: '8px',
                    },
                    duration: Infinity,
                })
            } else {
                const id = toast.loading(`Прогресс загрузки: ${progress}%`, {
                    style: {
                        background: '#292C36',
                        color: '#ffffff',
                        border: 'solid 1px #363944',
                        borderRadius: '8px',
                    },
                    duration: Infinity,
                })
                downloadToastIdRef.current = id
            }
        }

        const handleSuccess = (event: any, data: any) => {
            if (downloadToastIdRef.current) {
                toast.dismiss(downloadToastIdRef.current)
                downloadToastIdRef.current = null
            }
            toast.success('Обновление прошло успешно!', {
                style: {
                    background: '#292C36',
                    color: '#ffffff',
                    border: 'solid 1px #363944',
                    borderRadius: '8px',
                },
            })

            if (patcherInfo.length > 0) {
                setApp((prevApp: SettingsInterface) => ({
                    ...prevApp,
                    patcher: {
                        ...prevApp.patcher,
                        patched: true,
                        version: patcherInfo[0].modVersion,
                    },
                }))
            } else {
                toast.error('Ошибка обновления', {
                    style: {
                        background: '#292C36',
                        color: '#ffffff',
                        border: 'solid 1px #363944',
                        borderRadius: '8px',
                    },
                })
            }

            setIsUpdating(false)
        }

        const handleFailure = (event: any, error: any) => {
            if (downloadToastIdRef.current) {
                toast.dismiss(downloadToastIdRef.current)
                downloadToastIdRef.current = null
            }
            toast.error(`Обновление не удалось: ${error.error}`, {
                style: {
                    background: '#292C36',
                    color: '#ffffff',
                    border: 'solid 1px #363944',
                    borderRadius: '8px',
                },
            })

            setIsUpdating(false)
        }

        const handleUpdateAvailable = (event: any, data: any) => {
            setUpdate(true)
            toast('Доступно обновление!', {
                icon: '🛠️',
                style: {
                    background: '#292C36',
                    color: '#ffffff',
                    border: 'solid 1px #363944',
                    borderRadius: '8px',
                },
            })
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
    }, [patcherInfo])

    const startUpdate = () => {
        if (isUpdating) {
            toast('Обновление уже запущено!', {
                icon: 'ℹ️',
                style: {
                    background: '#292C36',
                    color: '#ffffff',
                    border: 'solid 1px #363944',
                    borderRadius: '8px',
                },
            })
            return
        }

        if (patcherInfo.length === 0) {
            toast.error('Нет доступных обновлений для установки.', {
                style: {
                    background: '#292C36',
                    color: '#ffffff',
                    border: 'solid 1px #363944',
                    borderRadius: '8px',
                },
            })
            return
        }

        setIsUpdating(true)

        const id = toast.loading('Начало загрузки обновления...', {
            style: {
                background: '#292C36',
                color: '#ffffff',
                border: 'solid 1px #363944',
                borderRadius: '8px',
            },
            duration: Infinity,
        })
        downloadToastIdRef.current = id

        const { modVersion, downloadUrl, checksum } = patcherInfo[0]
        window.desktopEvents?.send('update-app-asar', {
            version: modVersion,
            link: downloadUrl,
            checksum,
        })
    }

    if (loadingPatchInfo) {
        return <Preloader />
    }

    return (
        <>
            <Helmet>
                <title>{title + ' - PulseSync'}</title>
            </Helmet>
            <div className={pageStyles.children}>
                <OldHeader goBack={goBack} />
                <div className={pageStyles.main_window}>
                    <div className={pageStyles.navigation_bar}>
                        <div className={pageStyles.navigation_buttons}>
                            <NavButtonPulse to="/trackinfo">
                                <DiscordIcon height={24} width={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/extensionbeta">
                                <MdExtension size={24} />
                                <div className={pageStyles.betatest}>beta</div>
                            </NavButtonPulse>
                            <NavButtonPulse to="/store" disabled>
                                <MdStoreMallDirectory size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/contact" disabled>
                                <MdConnectWithoutContact size={24} />
                            </NavButtonPulse>
                        </div>
                        <div className={pageStyles.navigation_buttons}>
                            {updateAvailable && (
                                <button
                                    onClick={() => {
                                        setUpdate(false)
                                        startUpdate()
                                    }}
                                    className={pageStyles.update_download}
                                >
                                    <MdDownload size={24} />
                                </button>
                            )}
                        </div>
                    </div>

                    {patcherInfo.length > 0 &&
                        (!app.patcher.patched ||
                            (patcherInfo[0] &&
                                app.patcher.version <
                                    patcherInfo[0].modVersion)) && (
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
                                                    {app.patcher.version
                                                        ? app.patcher.version
                                                        : 'Не установлен'}
                                                </div>
                                                <MdKeyboardArrowRight size={14} />
                                                <div
                                                    className={
                                                        pageStyles.version_new
                                                    }
                                                >
                                                    {patcherInfo[0]?.modVersion}
                                                </div>
                                            </div>
                                            <div className={pageStyles.alert_title}>
                                                {app.patcher.patched
                                                    ? 'Обновление патча'
                                                    : 'Установка патча'}
                                            </div>
                                            <div className={pageStyles.alert_warn}>
                                                Убедитесь, что Яндекс Музыка закрыта!
                                            </div>
                                        </div>
                                        <button
                                            className={pageStyles.patch_button}
                                            onClick={startUpdate}
                                        >
                                            <MdUpdate size={20} />
                                            {app.patcher.patched
                                                ? 'Обновить'
                                                : 'Установить'}
                                        </button>
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
            <Toaster />
        </>
    )
}

export default Layout
