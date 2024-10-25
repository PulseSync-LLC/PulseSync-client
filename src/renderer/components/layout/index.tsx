import * as styles from './layout.module.scss'
import React, { useContext, useEffect } from 'react'
import { Helmet } from 'react-helmet'
import Header from './header'
import NavButtonPulse from '../nav_button_pulse';
import Discord from './../../../../static/assets/icons/discord.svg'
import {
    MdBugReport,
    MdConnectWithoutContact,
    MdDownload,
    MdEngineering,
    MdExtension,
    MdStoreMallDirectory,
} from 'react-icons/md'
import userContext from '../../api/context/user.context'
import hotToast from 'react-hot-toast'
import toast from '../../api/toast'

interface p {
    title: string
    children: any
    goBack?: boolean
}

const Layout: React.FC<p> = ({ title, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, user } =
        useContext(userContext)
    const toastLoading = (event: any, title: string) => {
        let toastId: string
        toastId = hotToast.loading(title, {
            style: {
                background: '#292C36',
                color: '#ffffff',
                border: 'solid 1px #363944',
                borderRadius: '8px',
            },
        })
        const handleUpdateAppData = (event: any, data: any) => {
            for (const [key] of Object.entries(data)) {
                switch (key) {
                    case 'patch':
                        toast.success('Успешный патч', { id: toastId })
                        break
                    default:
                        hotToast.dismiss(toastId)
                        break
                }
            }
            window.desktopEvents?.removeAllListeners('UPDATE_APP_DATA')
        }

        window.desktopEvents?.on('UPDATE_APP_DATA', handleUpdateAppData)
    }
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.desktopEvents?.on('update-available', (event, data) => {
                setUpdate(true)
            })
            return () => {
                window.desktopEvents?.removeAllListeners('update-available')
            }
        }
    }, [])
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
                            <NavButtonPulse to="/trackinfo">
                                <Discord height={24} width={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/extension">
                                <MdExtension size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/extensionbeta">
                                <MdExtension size={24} />
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
                                        window.desktopEvents?.send('update-install')
                                    }}
                                    className={styles.update_download}
                                >
                                    <MdDownload size={24} />
                                </button>
                            )}
                        </div>
                    </div>

                    {!app.patcher.patched && (
                        <div className={styles.alert_patch}>
                            <div className={styles.patch_container}>
                                <img
                                    className={styles.alert_patch_image}
                                    src="static\assets\images\imageAlertPatch.png"
                                    alt=""
                                />
                                <div className={styles.patch_detail}>
                                    <div className={styles.alert_info}>
                                        <div className={styles.alert_title}>
                                            Отсутствует патч!
                                        </div>
                                        <div className={styles.alert_warn}>
                                            Убедитесь что Яндекс Музыка закрыта!
                                        </div>
                                    </div>
                                    <button
                                        className={styles.patch_button}
                                        onClick={e => {
                                            toastLoading(e, 'Патч...')
                                            window.electron.patcher.patch()
                                            setApp({
                                                ...app,
                                                patcher: {
                                                    ...app.patcher,
                                                    patched: true,
                                                },
                                            })
                                        }}
                                    >
                                        <MdEngineering size={20} />
                                        Запатчить
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {children}
                </div>
            </div>
        </>
    )
}

export default Layout
