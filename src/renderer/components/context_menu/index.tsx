import React, { useContext, useEffect } from 'react'
import * as menuStyles from './context_menu.module.scss'
import userContext from '../../api/context/user.context'
import playerContext from '../../api/context/player.context'

import ArrowContext from './../../../../static/assets/icons/arrowContext.svg'
import hotToast from 'react-hot-toast-magic'
import toast from '../../api/toast'
import SettingsInterface from '../../api/interfaces/settings.interface'
import SettingsInitials from '../../api/initials/settings.initials'
import settingsInitials from '../../api/initials/settings.initials'

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
    const { app, setApp, setMod, modInfo } = useContext(userContext)
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

        const handleFailure = (event: any, args: any) => {
            toast.error(`Ошибка удаления мода: ${args.error}`, {
                id: toastId,
            })
        }

        const handleSuccess = (event: any, args: any) => {
            toast.success(`Мод удален успешно`, {
                id: toastId,
            })
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

        window.desktopEvents?.once('remove-mod-success', handleSuccess)
        window.desktopEvents?.once('remove-mod-failure', handleFailure)
    }

    const deleteMod = (e: any) => {
        showLoadingToast(e, 'Удаление мода...')
        window.desktopEvents.send('remove-mod')
    }

    const openGitHub = () => {
        window.open('https://github.com/PulseSync-LLC/YMusic-DRPC/tree/dev')
    }

    const toggleSetting = (type: string, status: boolean) => {
        const updatedSettings = { ...app.settings }
        switch (type) {
            case 'autoTray':
                updatedSettings.autoStartInTray = status
                window.electron.store.set('settings.autoStartInTray', status)
                toast.success(
                    `Опция "Автозапуск в трее" ${status ? 'включена' : 'выключена'}`
                )
                break
            case 'autoStart':
                updatedSettings.autoStartApp = status
                window.electron.store.set('settings.autoStartApp', status)
                window.desktopEvents?.send('autoStartApp', status)
                toast.success(
                    `Опция "Автозапуск приложения" ${status ? 'включена' : 'выключена'}`
                )
                break
            case 'autoStartMusic':
                updatedSettings.autoStartMusic = status
                window.electron.store.set('settings.autoStartMusic', status)
                toast.success(
                    `Опция "Автозапуск музыки" ${status ? 'включена' : 'выключена'}`
                )
                break
            case 'writeMetadataToggle':
                updatedSettings.writeMetadataAfterDownload = status
                window.electron.store.set('settings.writeMetadataAfterDownload', status)
                toast.success(
                    `Опция "Запись метаданных после загрузки" ${status ? 'включена' : 'выключена'}`
                )
                break
            case 'closeAppInTray':
                updatedSettings.closeAppInTray = status
                window.electron.store.set('settings.closeAppInTray', status)
                toast.success(
                    `Опция "Закрытие приложения в трее" ${status ? 'включена' : 'выключена'}`
                )
                break
            case 'deletePextAfterImport':
                updatedSettings.deletePextAfterImport = status
                window.electron.store.set('settings.deletePextAfterImport', status)
                toast.success(
                    `Включена функция удаления .pext после импорта темы`
                )
                break
            case 'hardwareAcceleration':
                updatedSettings.hardwareAcceleration = status
                window.electron.store.set('settings.hardwareAcceleration', status)
                toast.success(
                    'Изменения вступят в силу после перезапуска приложения'
                )
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
            metadata: app.settings.writeMetadataAfterDownload,
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

    function createButtonSection(
        title: string,
        buttons: SectionItem[],
    ): SectionConfig {
        return { title, buttons }
    }

    function createContentSection(content: React.ReactNode): SectionConfig {
        return { content }
    }

    function createToggleSection(
        title: string,
        checked: boolean,
        onToggle: () => void,
    ): SectionConfig {
        return createContentSection(
            <button
                className={menuStyles.contextButton}
                onClick={() => {
                    onToggle()
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
            </button>,
        )
    }

    function createToggleButton(
        title: string,
        checked: boolean,
        onToggle: () => void,
    ): SectionItem {
        return {
            label: (
                <>
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
                </>
            ),
            onClick: (event) => {
                onToggle()
            },
        }
    }

    const buttonConfigs: SectionConfig[] = [
        createContentSection(
            <button className={menuStyles.contextButton} onClick={openAppDirectory}>
                Директория приложения
            </button>,
        ),
        createButtonSection('Мод', [
            {
                label: 'Удалить мод',
                onClick: deleteMod,
                disabled: !app.mod.installed,
            },
            {
                label: 'Проверить обновления мода',
                onClick: () => window.getModInfo(app),
                disabled: !app.mod.installed,
            },
            { label: 'Скрипт мода на GitHub', onClick: openGitHub },
        ]),
        createButtonSection('Настройки приложения', [
            createToggleButton('Автотрей', app.settings.autoStartInTray, () =>
                toggleSetting('autoTray', !app.settings.autoStartInTray),
            ),
            createToggleButton(
                'Автозапуск приложения',
                app.settings.autoStartApp,
                () => toggleSetting('autoStart', !app.settings.autoStartApp),
            ),
            createToggleButton(
                'Скрыть окно при нажатии на «X»',
                app.settings.closeAppInTray,
                () => toggleSetting('closeAppInTray', !app.settings.closeAppInTray),
            ),
            createToggleButton(
                'Аппаратное ускорение',
                app.settings.hardwareAcceleration,
                () => toggleSetting('hardwareAcceleration', !app.settings.hardwareAcceleration),
            ),
            createToggleButton(
                'Удалять .pext после импорта темы?',
                app.settings.deletePextAfterImport,
                () =>
                    toggleSetting(
                        'deletePextAfterImport',
                        !app.settings.deletePextAfterImport,
                    ),
            ),
        ]),
        createButtonSection('Музыка', [
            {
                label: `Скачать ${currentTrack.title} в папку музыка`,
                onClick: downloadTrack,
                disabled: !currentTrack.url,
            },
            createToggleButton(
                'Запись метаданных в трек',
                app.settings.writeMetadataAfterDownload,
                () =>
                    toggleSetting(
                        'writeMetadataToggle',
                        !app.settings.writeMetadataAfterDownload,
                    ),
            ),
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
