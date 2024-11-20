import * as styles from './layout.module.scss'
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet'
import Header from './header'
import NavButtonPulse from '../nav_button_pulse'
import Discord from './../../../../static/assets/icons/discord.svg'
import {
    MdConnectWithoutContact,
    MdDownload,
    MdExtension,
    MdKeyboardArrowRight,
    MdStoreMallDirectory,
    MdUpdate,
} from 'react-icons/md'
import userContext from '../../api/context/user.context'
import { Toaster, toast } from 'react-hot-toast-magic'
import { compareVersions } from '../../utils/utils'
import SettingsInterface from '../../api/interfaces/settings.interface'

interface PatchInfo {
    version: string
    downloadUrl: string
    checksum: string
}

interface P {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<P> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, patcherInfo } = useContext(userContext)
    const [isUpdating, setIsUpdating] = useState(false)
    const downloadToastIdRef = useRef<string | null>(null)
    const sortedInfoRef = useRef<PatchInfo[]>([])

    const sortedInfo = useMemo(() => {
        const info = patcherInfo
            .filter(info => compareVersions(info.version, app.patcher.version) > 0)
            .sort((a, b) => compareVersions(a.version, b.version))
        sortedInfoRef.current = info
        return info
    }, [patcherInfo, app.patcher.version])

    useEffect(() => {
        console.log('patcherInfo:', patcherInfo)
        console.log('sortedInfo:', sortedInfo)
        console.log('app:', app)
    }, [patcherInfo, sortedInfo, app])

    useEffect(() => {
        const handleProgress = (event: any, { progress }: { progress: number }) => {
            console.log('Download progress:', progress)

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
            console.log('Update success:', data)
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

            if (sortedInfoRef.current.length > 0) {
                setApp((prevApp: SettingsInterface) => ({
                    ...prevApp,
                    patcher: {
                        ...prevApp.patcher,
                        patched: true,
                        version: sortedInfoRef.current[0].version,
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
            console.error('Update failure:', error)
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
            window.desktopEvents?.removeListener('download-progress', handleProgress)
            window.desktopEvents?.removeListener('update-success', handleSuccess)
            window.desktopEvents?.removeListener('update-failure', handleFailure)
            window.desktopEvents?.removeListener('update-available', handleUpdateAvailable)
        }
    }, [])

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

        if (sortedInfo.length === 0) {
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

        const { version, downloadUrl, checksum } = sortedInfo[0]
        window.desktopEvents?.send('update-app-asar', { version, link: downloadUrl, checksum })
    }

    return (
        <>
            <Helmet>
                <title>{title + ' - PulseSync'}</title>
            </Helmet>
            <div className={styles.children}>
                <Header goBack={goBack} />
                <div className={styles.main_window}>
                    <div className={styles.navigation_bar}>
                        <div className={styles.navigation_buttons}>
                            <NavButtonPulse to="/extensionbeta">
                                <MdExtension size={24} />
                                <div className={styles.betatest}>beta</div>
                            </NavButtonPulse>
                            <NavButtonPulse to="/store" disabled>
                                <MdStoreMallDirectory size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/contact" disabled>
                                <MdConnectWithoutContact size={24} />
                            </NavButtonPulse>
                        </div>
                        <div className={styles.navigation_buttons}>
                            {updateAvailable && (
                                <button
                                    onClick={() => {
                                        setUpdate(false)
                                        startUpdate()
                                    }}
                                    className={styles.update_download}
                                >
                                    <MdDownload size={24} />
                                </button>
                            )}
                        </div>
                    </div>

                    {(!app.patcher.patched || (sortedInfo[0] && app.patcher.version !== sortedInfo[0].version)) && (
                        <div className={styles.alert_patch}>
                            <div className={styles.patch_container}>
                                <div className={styles.patch_detail}>
                                    <div className={styles.alert_info}>
                                        <div className={styles.alert_version_update}>
                                            <div className={styles.version_old}>
                                                {app.patcher.version ? app.patcher.version : 'Не установлен'}
                                            </div>
                                            <MdKeyboardArrowRight size={14} />
                                            <div className={styles.version_new}>
                                                {sortedInfo[0]?.version}
                                            </div>
                                        </div>
                                        <div className={styles.alert_title}>
                                            {app.patcher.patched ? 'Обновление патча' : 'Установка патча'}
                                        </div>
                                        <div className={styles.alert_warn}>
                                            Убедитесь, что Яндекс Музыка закрыта!
                                        </div>
                                    </div>
                                    <button
                                        className={styles.patch_button}
                                        onClick={() => {
                                            startUpdate()
                                        }}
                                    >
                                        <MdUpdate size={20} />
                                        {app.patcher.patched ? 'Обновить' : 'Установить'}
                                    </button>
                                </div>
                                <img
                                    className={styles.alert_patch_image}
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
