import React, { useContext } from 'react'
import * as menuStyles from './context_menu.module.scss'
import userContext from '../../api/context/user.context'

import ArrowContext from './../../../../static/assets/icons/arrowContext.svg'
import toast from '../toast'
import SettingsInterface from '../../api/interfaces/settings.interface'
import store from '../../api/store/store'
import { openModal } from '../../api/store/modalSlice'

interface ContextMenuProps {
    modalRef: React.RefObject<{
        openUpdateModal: () => void
        closeUpdateModal: () => void
    }>
}

interface SectionItem {
    label: React.ReactNode
    onClick?: (event: any) => void
    disabled?: boolean
    isDev?: boolean
}

interface SectionConfig {
    title?: string
    buttons?: SectionItem[]
    content?: React.ReactNode
}

const ContextMenu: React.FC<ContextMenuProps> = ({ modalRef }) => {
    const { app, setApp } = useContext(userContext)

    const openUpdateModal = () => {
        modalRef.current?.openUpdateModal()
    }

    const openAppDirectory = () => {
        window.desktopEvents?.send('openPath', { action: 'appPath' })
    }

    const showLoadingToast = (event: any, message: string) => {
        const toastId = toast.custom('info', 'Ожидайте', message)

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', `Что-то не так`, `Ошибка удаления мода: ${args.error}`, {
                id: toastId,
            })
        }

        const handleSuccess = (event: any, args: any) => {
            toast.custom('success', `Готово`, `Мод удален успешно`, {
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
        window.desktopEvents?.send('remove-mod')
    }

    const openGitHub = () => {
        window.open('https://github.com/PulseSync-LLC/PulseSync-client/tree/dev')
    }

    const toggleSetting = (type: string, status: boolean) => {
        const updatedSettings = { ...app.settings }
        switch (type) {
            case 'autoTray':
                updatedSettings.autoStartInTray = status
                window.electron.store.set('settings.autoStartInTray', status)
                toast.custom('success', `Готово`, `Опция "Автозапуск в трее" ${status ? 'включена' : 'выключена'}`)
                break
            case 'autoStart':
                updatedSettings.autoStartApp = status
                window.electron.store.set('settings.autoStartApp', status)
                window.desktopEvents?.send('autoStartApp', status)
                toast.custom('success', `Готово`, `Опция "Автозапуск приложения" ${status ? 'включена' : 'выключена'}`)
                break
            case 'autoStartMusic':
                updatedSettings.autoStartMusic = status
                window.electron.store.set('settings.autoStartMusic', status)
                toast.custom('success', `Готово`, `Опция "Автозапуск музыки" ${status ? 'включена' : 'выключена'}`)
                break
            case 'askSavePath':
                updatedSettings.askSavePath = status
                window.electron.store.set('settings.askSavePath', status)
                toast.custom('success', `Готово`, `Опция "Спрашивать куда сохранять трек" ${status ? 'включена' : 'выключена'}`)
                break
            case 'saveAsMp3':
                updatedSettings.saveAsMp3 = status
                window.electron.store.set('settings.saveAsMp3', status)
                toast.custom('success', `Готово`, `Опция "Сохранять в формате mp3" ${status ? 'включена' : 'выключена'}`)
                break
            case 'closeAppInTray':
                updatedSettings.closeAppInTray = status
                window.electron.store.set('settings.closeAppInTray', status)
                toast.custom('success', `Готово`, `Опция "Закрытие приложения в трее" ${status ? 'включена' : 'выключена'}`)
                break
            case 'deletePextAfterImport':
                updatedSettings.deletePextAfterImport = status
                window.electron.store.set('settings.deletePextAfterImport', status)
                toast.custom('success', `Готово`, `Включена функция удаления .pext после импорта темы`)
                break
            case 'hardwareAcceleration':
                updatedSettings.hardwareAcceleration = status
                window.electron.store.set('settings.hardwareAcceleration', status)
                toast.custom('success', `Готово`, 'Изменения вступят в силу после перезапуска приложения')
                break
            case 'devSocket':
                updatedSettings.devSocket = status
                window.electron.store.set('settings.devSocket', status)
                console.log(updatedSettings.devSocket)
                updatedSettings.devSocket ? window.desktopEvents?.send('WEBSOCKET_START') : window.desktopEvents?.send('WEBSOCKET_STOP')
                toast.custom('success', `Готово`, 'Статус вебсокета изменен')
                break
            case 'showModModalAfterInstall':
                updatedSettings.showModModalAfterInstall = status
                window.electron.store.set('settings.showModModalAfterInstall', status)
                toast.custom('success', `Готово`, `Опция "Показывать список изменений после установки" ${status ? 'включена' : 'выключена'}`)
                break
            case 'saveWindowPositionOnRestart':
                updatedSettings.saveWindowPositionOnRestart = status
                window.electron.store.set('settings.saveWindowPositionOnRestart', status)
                toast.custom('success', `Готово`, `Опция "Сохранять положение окна" ${status ? 'включена' : 'выключена'}`)
                break
            case 'saveWindowDimensionsOnRestart':
                updatedSettings.saveWindowDimensionsOnRestart = status
                window.electron.store.set('settings.saveWindowDimensionsOnRestart', status)
                toast.custom('success', `Готово`, `Опция "Сохранять размер окна" ${status ? 'включена' : 'выключена'}`)
                break
        }
        setApp({ ...app, settings: updatedSettings })
    }

    function createButtonSection(title: string, buttons: SectionItem[]): SectionConfig {
        return { title, buttons }
    }

    function createContentSection(content: React.ReactNode): SectionConfig {
        return { content }
    }

    function createToggleSection(title: string, checked: boolean, onToggle: () => void): SectionConfig {
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
                        className={checked ? `${menuStyles.custom_checkbox_menu_dot} ${menuStyles.active}` : menuStyles.custom_checkbox_menu_dot}
                    ></div>
                </div>
            </button>,
        )
    }

    function createToggleButton(title: string, checked: boolean, onToggle: () => void, isDev?: boolean): SectionItem {
        if (isDev && !window.electron.isAppDev()) {
            return null
        }
        return {
            label: (
                <>
                    <span>{title}</span>
                    <div className={menuStyles.custom_checkbox_menu}>
                        <div
                            className={checked ? `${menuStyles.custom_checkbox_menu_dot} ${menuStyles.active}` : menuStyles.custom_checkbox_menu_dot}
                        ></div>
                    </div>
                </>
            ),
            onClick: event => {
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
                label: app.mod.installed && app.mod.version ? `${app.mod.name || 'Eclipse'} v${app.mod.version}` : 'Не установлен',
                onClick: () => store.dispatch(openModal()),
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: 'Удалить мод',
                onClick: deleteMod,
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: 'Проверить обновления мода',
                onClick: () => window.getModInfo(app),
                disabled: !app.mod.installed || !app.mod.version,
            },
            createToggleButton('Показывать список изменений после установки', app.settings.showModModalAfterInstall, () =>
                toggleSetting('showModModalAfterInstall', !app.settings.showModModalAfterInstall),
            ),
        ]),
        createButtonSection('Настройки приложения', [
            createToggleButton('Автозапуск приложения', app.settings.autoStartApp, () => toggleSetting('autoStart', !app.settings.autoStartApp)),
            createToggleButton('Аппаратное ускорение', app.settings.hardwareAcceleration, () =>
                toggleSetting('hardwareAcceleration', !app.settings.hardwareAcceleration),
            ),
            createToggleButton('Удалять .pext после импорта темы', app.settings.deletePextAfterImport, () =>
                toggleSetting('deletePextAfterImport', !app.settings.deletePextAfterImport),
            ),
        ]),
        createButtonSection('Настройки окна приложения', [
            createToggleButton('Сохранять размер окна', app.settings.saveWindowDimensionsOnRestart, () =>
                toggleSetting('saveWindowDimensionsOnRestart', !app.settings.saveWindowDimensionsOnRestart),
            ),
            createToggleButton('Сохранять положение окна', app.settings.saveWindowPositionOnRestart, () =>
                toggleSetting('saveWindowPositionOnRestart', !app.settings.saveWindowPositionOnRestart),
            ),
            createToggleButton('Автотрей', app.settings.autoStartInTray, () => toggleSetting('autoTray', !app.settings.autoStartInTray)),
            createToggleButton('Скрыть окно при нажатии на «X»', app.settings.closeAppInTray, () =>
                toggleSetting('closeAppInTray', !app.settings.closeAppInTray),
            ),
        ]),
        createButtonSection('Особое', [
            { label: `Версия: v${app.info.version} #${window.appInfo.getBranch()}`, onClick: openUpdateModal },
            {
                label: 'Проверить обновления',
                onClick: () => window.desktopEvents?.send('checkUpdate'),
            },
            {
                label: 'Собрать логи в архив',
                onClick: () => {
                    window.desktopEvents?.send('getLogArchive')
                    toast.custom('success', `Готово`, 'Скоро открою папку')
                },
            },
            createToggleButton(
                'Статус вебсокета',
                app.settings.devSocket,
                () => {
                    toggleSetting('devSocket', !app.settings.devSocket)
                },
                true,
            ),
        ]),
    ]

    return (
        <div className={menuStyles.modMenu}>
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
                                    {section.buttons
                                        ?.filter(Boolean)
                                        .filter(button => !button.isDev || (button.isDev && window.electron.isAppDev()))
                                        .map((button, i) => (
                                            <button key={i} className={menuStyles.contextButton} onClick={button.onClick} disabled={button.disabled}>
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
