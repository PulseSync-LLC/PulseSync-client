import React, { useContext } from 'react'
import * as styles from './context_menu.module.scss'
import userContext from '../../api/context/user.context'

import ArrowContext from './../../../../static/assets/icons/arrowContext.svg'
import playerContext from '../../api/context/player.context'
import hotToast from 'react-hot-toast-magic'
import toast from '../../api/toast'

interface ContextMenuProps {
    modalRef: React.RefObject<{ openModal: () => void; closeModal: () => void }>
}

interface SectionConfig {
    title: string
    buttons: {
        label: string
        onClick: (event: any) => void
        disabled?: boolean
    }[]
    button?: {
        label: string
        onClick: (event: any) => void
    }
}

const ContextMenu: React.FC<ContextMenuProps> = ({ modalRef }) => {
    const { app, setApp, setUser } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)

    const handleOpenModal = () => {
        modalRef.current?.openModal()
    }

    const directoryOpen = () => {
        window.desktopEvents.send('openPath', { action: 'appPath' })
    }

    const repatch = (e: any) => {
        toastLoading(e, 'Репатч...')
        window.electron.patcher.repatch()
    }

    const depatch = (e: any) => {
        toastLoading(e, 'Депатч...')
        window.electron.patcher.depatch()
        setApp({
            ...app,
            patcher: {
                ...app.patcher,
                patched: false,
            },
        })
    }

    const githubLink = () => {
        window.open(
            'https://github.com/PulseSync-LLC/YMusic-DRPC/tree/patcher-ts',
        )
    }

    const enableFunc = (type: string, status: boolean) => {
        const updatedSettings = { ...app.settings }
        switch (type) {
            case 'autoTray':
                updatedSettings.autoStartInTray = status
                window.electron.store.set('settings.autoStartInTray', status)
                break
            case 'autoStart':
                updatedSettings.autoStartApp = status
                window.electron.store.set('settings.autoStartApp', status)
                window.desktopEvents?.send('autoStartApp', status)
                break
            case 'autoStartMusic':
                updatedSettings.autoStartMusic = status
                window.electron.store.set('settings.autoStartMusic', status)
                break
        }
        setApp({ ...app, settings: updatedSettings })
    }

    const downloadTrack = (event: any) => {
        let toastId: string
        console.log(currentTrack)
        toastId = hotToast.loading('Загрузка...', {
            style: {
                background: '#292C36',
                color: '#ffffff',
                border: 'solid 1px #363944',
                borderRadius: '8px',
            },
        })

        window.desktopEvents?.on(
            'download-track-progress',
            (event, value) => {
                toast.loading(
                    <>
                        <span>Загрузка</span>
                        <b style={{marginLeft: '.5em'}}>
                            {Math.floor(value)}%
                        </b>
                    </>,
                    {
                        id: toastId,
                    },
                )
            },
        )
        window.electron.downloadTrack({
            track: currentTrack,
            url: currentTrack.url
        })

        window.desktopEvents?.once('download-track-cancelled', () =>
            hotToast.dismiss(toastId),
        )
        window.desktopEvents?.once('download-track-failed', () =>
            toast.error('Ошибка загрузки трека', {id: toastId}),
        )
        window.desktopEvents?.once('download-track-finished', () => {
            toast.success('Загрузка завершена', {id: toastId})
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
                    onClick: githubLink,
                },
            ],
        },
        {
            title: 'Автотрей',
            buttons: [
                {
                    label: 'Включить',
                    onClick: () => enableFunc('autoTray', true),
                    disabled: app.settings.autoStartInTray,
                },
                {
                    label: 'Выключить',
                    onClick: () => enableFunc('autoTray', false),
                    disabled: !app.settings.autoStartInTray,
                },
            ],
        },
        {
            title: 'Автозапуск приложения',
            buttons: [
                {
                    label: 'Включить',
                    onClick: () => enableFunc('autoStart', true),
                    disabled: app.settings.autoStartApp,
                },
                {
                    label: 'Выключить',
                    onClick: () => enableFunc('autoStart', false),
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
                    onClick: handleOpenModal,
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
            for (const [key, value] of Object.entries(data)) {
                switch (key) {
                    case 'repatch':
                        toast.success('Успешный репатч', { id: toastId })
                        break
                    case 'patch':
                        toast.success('Успешный патч', { id: toastId })
                        break
                    case 'depatch':
                        toast.success('Успешный депатч', { id: toastId })
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
    return (
        <div className={styles.patchMenu}>
            <button className={styles.contextButton} onClick={directoryOpen}>
                Директория приложения
            </button>
            {buttonConfigs.map(section => (
                <div className={styles.innerFunction} key={section.title}>
                    {section.title}
                    <ArrowContext />
                    <div className={styles.showButtons}>
                        {section.buttons.map((button, index) => (
                            <button
                                key={index}
                                className={styles.contextButton}
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
