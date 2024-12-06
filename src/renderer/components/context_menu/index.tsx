import React, { useContext } from 'react'
import * as menuStyles from './context_menu.module.scss'
import userContext from '../../api/context/user.context'
import playerContext from '../../api/context/player.context'

import ArrowContext from './../../../../static/assets/icons/arrowContext.svg'
import hotToast from 'react-hot-toast-magic'
import toast from '../../api/toast'

interface ContextMenuProps {
    modalRef: React.RefObject<{ openModal: () => void; closeModal: () => void }>
}

interface SectionItem {
    label: string
    onClick: (event: any) => void
    disabled?: boolean
}

interface SectionConfig {
    title: string
    buttons: SectionItem[]
}

const ContextMenu: React.FC<ContextMenuProps> = ({ modalRef }) => {
    const { app, setApp } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)

    const openModal = () => {
        modalRef.current?.openModal()
    }

    const openAppDirectory = () => {
        window.desktopEvents.send('openPath', { action: 'appPath' })
    }

    const showLoadingToast = (event: any, message: string) => {
        const toastId = hotToast.loading(message, {
            style: {
                background: '#292C36',
                color: '#ffffff',
                border: 'solid 1px #363944',
                borderRadius: '8px',
            },
        })

        const handleUpdateAppData = (event: any, data: any) => {
            for (const [key] of Object.entries(data)) {
                if (key === 'repatch') {
                    toast.success('Успешный репатч', { id: toastId })
                } else if (key === 'patch') {
                    toast.success('Успешный патч', { id: toastId })
                } else if (key === 'depatch') {
                    toast.success('Успешный депатч', { id: toastId })
                } else {
                    hotToast.dismiss(toastId)
                }
            }
            window.desktopEvents?.removeAllListeners('UPDATE_APP_DATA')
        }

        window.desktopEvents?.on('UPDATE_APP_DATA', handleUpdateAppData)
    }

    const repatch = (e: any) => {
        showLoadingToast(e, 'Репатч...')
        window.electron.patcher.repatch()
    }

    const depatch = (e: any) => {
        showLoadingToast(e, 'Депатч...')
        window.electron.patcher.depatch()
        setApp({
            ...app,
            patcher: {
                ...app.patcher,
                patched: false,
            },
        })
    }

    const openGitHub = () => {
        window.open(
            'https://github.com/PulseSync-LLC/YMusic-DRPC/tree/patcher-ts',
        )
    }

    const toggleSetting = (type: string, status: boolean) => {
        const updatedSettings = { ...app.settings }
        if (type === 'autoTray') {
            updatedSettings.autoStartInTray = status
            window.electron.store.set('settings.autoStartInTray', status)
        } else if (type === 'autoStart') {
            updatedSettings.autoStartApp = status
            window.electron.store.set('settings.autoStartApp', status)
            window.desktopEvents?.send('autoStartApp', status)
        } else if (type === 'autoStartMusic') {
            updatedSettings.autoStartMusic = status
            window.electron.store.set('settings.autoStartMusic', status)
        }
        setApp({ ...app, settings: updatedSettings })
    }

    const downloadTrack = (event: any) => {
        const toastId = hotToast.loading('Загрузка...', {
            style: {
                background: '#292C36',
                color: '#ffffff',
                border: 'solid 1px #363944',
                borderRadius: '8px',
            },
        })

        window.desktopEvents?.on('download-track-progress', (event, value) => {
            toast.loading(
                <>
                    <span>Загрузка</span>
                    <b style={{ marginLeft: '.5em' }}>{Math.floor(value)}%</b>
                </>,
                { id: toastId },
            )
        })

        window.electron.downloadTrack({
            track: currentTrack,
            url: currentTrack.url,
        })

        window.desktopEvents?.once('download-track-cancelled', () =>
            hotToast.dismiss(toastId),
        )
        window.desktopEvents?.once('download-track-failed', () =>
            toast.error('Ошибка загрузки трека', { id: toastId }),
        )
        window.desktopEvents?.once('download-track-finished', () => {
            toast.success('Загрузка завершена', { id: toastId })
            window.desktopEvents?.removeAllListeners('download-track-progress')
        })
    }

    const buttonConfigs: SectionConfig[] = [
        {
            title: 'Патч',
            buttons: [
                {
                    label: 'Патч',
                    onClick: repatch,
                    disabled: app.patcher.patched,
                },
                {
                    label: 'Репатч',
                    onClick: repatch,
                    disabled: !app.patcher.patched,
                },
                {
                    label: 'Депатч',
                    onClick: depatch,
                    disabled: !app.patcher.patched,
                },
                {
                    label: 'Скрипт патчера на GitHub',
                    onClick: openGitHub,
                },
            ],
        },
        {
            title: 'Автотрей',
            buttons: [
                {
                    label: 'Включить',
                    onClick: () => toggleSetting('autoTray', true),
                    disabled: app.settings.autoStartInTray,
                },
                {
                    label: 'Выключить',
                    onClick: () => toggleSetting('autoTray', false),
                    disabled: !app.settings.autoStartInTray,
                },
            ],
        },
        {
            title: 'Автозапуск приложения',
            buttons: [
                {
                    label: 'Включить',
                    onClick: () => toggleSetting('autoStart', true),
                    disabled: app.settings.autoStartApp,
                },
                {
                    label: 'Выключить',
                    onClick: () => toggleSetting('autoStart', false),
                    disabled: !app.settings.autoStartApp,
                },
            ],
        },
        {
            title: 'Музыка',
            buttons: [
                {
                    label: `Скачать ${currentTrack.title} в папку музыка`,
                    onClick: downloadTrack,
                    disabled: !currentTrack.url,
                },
                {
                    label: 'Директория со скаченной музыкой',
                    onClick: () =>
                        window.desktopEvents.send('openPath', {
                            action: 'musicPath',
                        }),
                },
            ],
        },
        {
            title: 'Особое',
            buttons: [
                {
                    label: `Beta v${app.info.version}`,
                    onClick: openModal,
                },
                {
                    label: 'Проверить обновления',
                    onClick: () => window.desktopEvents?.send('checkUpdate'),
                },
                {
                    label: 'Собрать логи в архив',
                    onClick: () => {
                        window.desktopEvents.send('getLogArchive')
                        toast.success('Успешно')
                    },
                },
            ],
        },
    ]

    return (
        <div className={menuStyles.patchMenu}>
            <button
                className={menuStyles.contextButton}
                onClick={openAppDirectory}
            >
                Директория приложения
            </button>
            {buttonConfigs.map(section => (
                <div className={menuStyles.innerFunction} key={section.title}>
                    {section.title}
                    <ArrowContext />
                    <div className={menuStyles.showButtons}>
                        {section.buttons.map((button, index) => (
                            <button
                                key={index}
                                className={menuStyles.contextButton}
                                onClick={button.onClick}
                                disabled={button.disabled}
                            >
                                {button.label}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

export default ContextMenu
