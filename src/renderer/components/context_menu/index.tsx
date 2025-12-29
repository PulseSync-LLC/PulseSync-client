import React, { useContext } from 'react'
import * as menuStyles from './context_menu.module.scss'
import userContext from '../../api/context/user.context'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'

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
    const { app, setApp, widgetInstalled, setWidgetInstalled } = useContext(userContext)

    const openUpdateModal = () => {
        modalRef.current?.openUpdateModal()
    }

    const openAppDirectory = () => {
        window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'appPath' })
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

        window.desktopEvents?.once(RendererEvents.REMOVE_MOD_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.REMOVE_MOD_FAILURE, handleFailure)
    }

    const deleteMod = (e: any) => {
        showLoadingToast(e, 'Удаление мода...')
        window.desktopEvents?.send(MainEvents.REMOVE_MOD)
        window.localStorage.removeItem('lastNotifiedModVersion')
    }

    const downloadObsWidget = () => {
        const toastId = toast.custom('info', 'Ожидайте', 'Загрузка виджета OBS...')

        const handleSuccess = () => {
            toast.custom('success', 'Готово', 'Виджет OBS успешно установлен', { id: toastId })
            setWidgetInstalled(true)
        }

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', 'Ошибка', `Не удалось загрузить виджет: ${args.error}`, { id: toastId })
        }

        window.desktopEvents?.once(RendererEvents.DOWNLOAD_OBS_WIDGET_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.DOWNLOAD_OBS_WIDGET_FAILURE, handleFailure)
        window.desktopEvents?.send(MainEvents.DOWNLOAD_OBS_WIDGET)
    }

    const removeObsWidget = () => {
        const toastId = toast.custom('info', 'Ожидайте', 'Удаление виджета OBS...')

        const handleSuccess = () => {
            toast.custom('success', 'Готово', 'Виджет OBS успешно удален', { id: toastId })
            setWidgetInstalled(false)
        }

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', 'Ошибка', `Не удалось удалить виджет: ${args.error}`, { id: toastId })
        }

        window.desktopEvents?.once(RendererEvents.REMOVE_OBS_WIDGET_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.REMOVE_OBS_WIDGET_FAILURE, handleFailure)
        window.desktopEvents?.send(MainEvents.REMOVE_OBS_WIDGET)
    }

    const clearModCache = () => {
        const toastId = toast.custom('info', 'Ожидайте', 'Очистка кеша мода...')

        const handleSuccess = () => {
            toast.custom('success', 'Готово', 'Кеш мода успешно очищен', { id: toastId })
        }

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', 'Ошибка', `Не удалось очистить кеш: ${args.error}`, { id: toastId })
        }

        window.desktopEvents?.once(RendererEvents.CLEAR_MOD_CACHE_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.CLEAR_MOD_CACHE_FAILURE, handleFailure)
        window.desktopEvents?.send(MainEvents.CLEAR_MOD_CACHE)
    }

    const copyWidgetPath = async () => {
        try {
            const widgetPath = await window.desktopEvents?.invoke(MainEvents.GET_OBS_WIDGET_PATH)
            if (widgetPath) {
                await navigator.clipboard.writeText(widgetPath)
                toast.custom('success', 'Готово', 'Путь скопирован в буфер обмена')
            } else {
                toast.custom('error', 'Ошибка', 'Не удалось получить путь до виджета')
            }
        } catch (error) {
            toast.custom('error', 'Ошибка', 'Не удалось скопировать путь')
        }
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
                window.desktopEvents?.send(MainEvents.AUTO_START_APP, status)
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
                updatedSettings.devSocket
                    ? window.desktopEvents?.send(MainEvents.WEBSOCKET_START)
                    : window.desktopEvents?.send(MainEvents.WEBSOCKET_STOP)
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
        createButtonSection('Виджет OBS', [
            {
                label: 'Скачать виджет OBS' + (widgetInstalled ? '(установлен)' : '(не установлен)'),
                onClick: downloadObsWidget,
                disabled: widgetInstalled,
            },
            {
                label: 'Открыть папку с виджетом OBS',
                onClick: () => window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'obsWidgetPath' }),
                disabled: !widgetInstalled,
            },
            {
                label: 'Скопировать путь до виджета',
                onClick: copyWidgetPath,
                disabled: !widgetInstalled,
            },
            {
                label: 'Удалить виджет OBS',
                onClick: removeObsWidget,
                disabled: !widgetInstalled,
            },
        ]),
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
            {
                label: 'Очистить кеш мода',
                onClick: clearModCache
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
            { label: `Версия: v${app.info.version}. Commit #${window.appInfo.getBranch()}`, onClick: openUpdateModal },
            {
                label: 'Проверить обновления',
                onClick: () => window.desktopEvents?.send(MainEvents.CHECK_UPDATE),
            },
            {
                label: 'Собрать логи в архив',
                onClick: () => {
                    window.desktopEvents?.send(MainEvents.GET_LOG_ARCHIVE)
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
