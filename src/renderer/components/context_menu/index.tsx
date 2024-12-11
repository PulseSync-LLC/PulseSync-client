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
    label: React.ReactNode
    onClick: (event: any) => void
    disabled?: boolean
}

interface SectionConfig {
    title?: string
    buttons?: SectionItem[]
    content?: React.ReactNode
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

    const createButtonSection = (
        title: string,
        buttons: {
            label: React.ReactNode
            onClick: (event: any) => void
            disabled?: boolean
        }[],
    ): SectionConfig => ({
        title,
        buttons,
    })

    const createContentSection = (content: React.ReactNode): SectionConfig => ({
        content,
    })

    const createToggleSection = (
        title: string,
        checked: boolean,
        onToggle: () => void,
    ): SectionConfig =>
        createContentSection(
            <button
                className={menuStyles.contextButton}
                onClick={() => {
                    onToggle()
                    const newState = !checked
                    toast.success(
                        `${title} ${newState ? 'включён' : 'выключен'}`,
                    )
                }}
            >
                <span>{title}</span>
                <div className={menuStyles.custom_checkbox_menu}>
                    <div
                        className={
                            checked
                                ? `${menuStyles.custom_checkbox_menu_dot} ${menuStyles.active}`
                                : menuStyles.custom_checkbox_menu_dot
                        }
                    ></div>
                </div>
                <div style={{ display: 'none', alignItems: 'center' }}>
                    <input type="checkbox" checked={checked} readOnly />
                </div>
            </button>,
        )

    const buttonConfigs: SectionConfig[] = [
        createContentSection(
            <button
                className={menuStyles.contextButton}
                onClick={openAppDirectory}
            >
                Директория приложения
            </button>,
        ),
        createButtonSection('Патч', [
            { label: 'Патч', onClick: repatch, disabled: app.patcher.patched },
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
            { label: 'Скрипт патчера на GitHub', onClick: openGitHub },
        ]),
        createToggleSection('Автотрей', app.settings.autoStartInTray, () =>
            toggleSetting('autoTray', !app.settings.autoStartInTray),
        ),
        createToggleSection(
            'Автозапуск приложения',
            app.settings.autoStartApp,
            () => toggleSetting('autoStart', !app.settings.autoStartApp),
        ),
        createButtonSection('Музыка', [
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
        ]),
        createButtonSection('Особое', [
            { label: `Beta v${app.info.version}`, onClick: openModal },
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
        ]),
    ]

    return (
        <div className={menuStyles.patchMenu}>
            {buttonConfigs.map((section, index) => (
                <React.Fragment key={index}>
                    {section.content ? (
                        <div>{section.content}</div>
                    ) : (
                        <div className={menuStyles.innerFunction}>
                            {section.title && (
                                <>
                                    {section.title}
                                    <ArrowContext />
                                </>
                            )}
                            {section.buttons && (
                                <div className={menuStyles.showButtons}>
                                    {section.buttons.map((button, i) => (
                                        <button
                                            key={i}
                                            className={menuStyles.contextButton}
                                            onClick={button.onClick}
                                            disabled={button.disabled}
                                        >
                                            {button.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </React.Fragment>
            ))}
        </div>
    )
}

export default ContextMenu
