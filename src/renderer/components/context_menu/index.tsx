import React, { useContext } from 'react'
import * as menuStyles from './context_menu.module.scss'
import userContext from '../../api/context/user.context'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'

import ArrowContext from '../../assets/icons/arrowContext.svg'
import toast from '../toast'
import SettingsInterface from '../../api/interfaces/settings.interface'
import store from '../../api/store/store'
import { openModal } from '../../api/store/modalSlice'
import { useTranslation } from 'react-i18next'

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
    const { t, i18n } = useTranslation()
    const { app, setApp, widgetInstalled, setWidgetInstalled } = useContext(userContext)

    const openUpdateModal = () => {
        modalRef.current?.openUpdateModal()
    }

    const openAppDirectory = () => {
        window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'appPath' })
    }

    const showLoadingToast = (event: any, message: string) => {
        const toastId = toast.custom('info', t('common.waitTitle'), message)

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', t('common.somethingWrongTitle'), t('mod.removeError', { message: args.error }), {
                id: toastId,
            })
        }

        const handleSuccess = (event: any, args: any) => {
            toast.custom('success', t('common.doneTitle'), t('mod.removedSuccess'), {
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
        showLoadingToast(e, t('mod.removing'))
        window.desktopEvents?.send(MainEvents.REMOVE_MOD)
        window.localStorage.removeItem('lastNotifiedModVersion')
    }

    const downloadObsWidget = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('obsWidget.downloading'))

        const handleSuccess = () => {
            toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'), { id: toastId })
            setWidgetInstalled(true)
        }

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: args.error }), { id: toastId })
        }

        window.desktopEvents?.once(RendererEvents.DOWNLOAD_OBS_WIDGET_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.DOWNLOAD_OBS_WIDGET_FAILURE, handleFailure)
        window.desktopEvents?.send(MainEvents.DOWNLOAD_OBS_WIDGET)
    }

    const removeObsWidget = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('obsWidget.removing'))

        const handleSuccess = () => {
            toast.custom('success', t('common.doneTitle'), t('obsWidget.removeSuccess'), { id: toastId })
            setWidgetInstalled(false)
        }

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', t('common.errorTitle'), t('obsWidget.removeError', { message: args.error }), { id: toastId })
        }

        window.desktopEvents?.once(RendererEvents.REMOVE_OBS_WIDGET_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.REMOVE_OBS_WIDGET_FAILURE, handleFailure)
        window.desktopEvents?.send(MainEvents.REMOVE_OBS_WIDGET)
    }

    const clearModCache = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('mod.cacheClearing'))

        const handleSuccess = () => {
            toast.custom('success', t('common.doneTitle'), t('mod.cacheCleared'), { id: toastId })
        }

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', t('common.errorTitle'), t('mod.cacheClearError', { message: args.error }), { id: toastId })
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
                toast.custom('success', t('common.doneTitle'), t('obsWidget.pathCopied'))
            } else {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.pathFetchError'))
            }
        } catch (error) {
            toast.custom('error', t('common.errorTitle'), t('obsWidget.pathCopyError'))
        }
    }

    const toggleSetting = (type: string, status: boolean) => {
        const statusLabel = status ? t('common.enabled') : t('common.disabled')
        switch (type) {
            case 'autoTray':
                window.electron.store.set('settings.autoStartInTray', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoTray', { status: statusLabel }))
                break
            case 'autoStart':
                window.electron.store.set('settings.autoStartApp', status)
                window.desktopEvents?.send(MainEvents.AUTO_START_APP, status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoStartApp', { status: statusLabel }))
                break
            case 'autoStartMusic':
                window.electron.store.set('settings.autoStartMusic', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoStartMusic', { status: statusLabel }))
                break
            case 'askSavePath':
                window.electron.store.set('settings.askSavePath', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.askSavePath', { status: statusLabel }))
                break
            case 'saveAsMp3':
                window.electron.store.set('settings.saveAsMp3', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.saveAsMp3', { status: statusLabel }))
                break
            case 'closeAppInTray':
                window.electron.store.set('settings.closeAppInTray', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.closeAppInTray', { status: statusLabel }))
                break
            case 'deletePextAfterImport':
                window.electron.store.set('settings.deletePextAfterImport', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.deletePextAfterImport'))
                break
            case 'hardwareAcceleration':
                window.electron.store.set('settings.hardwareAcceleration', status)
                toast.custom('success', t('common.doneTitle'), t('settings.restartRequired'))
                break
            case 'devSocket':
                window.electron.store.set('settings.devSocket', status)
                console.log(status)
                status
                    ? window.desktopEvents?.send(MainEvents.WEBSOCKET_START)
                    : window.desktopEvents?.send(MainEvents.WEBSOCKET_STOP)
                toast.custom('success', t('common.doneTitle'), t('settings.websocketStatusChanged'))
                break
            case 'showModModalAfterInstall':
                window.electron.store.set('settings.showModModalAfterInstall', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.showModChangelog', { status: statusLabel }))
                break
            case 'saveWindowPositionOnRestart':
                window.electron.store.set('settings.saveWindowPositionOnRestart', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.saveWindowPosition', { status: statusLabel }))
                break
            case 'saveWindowDimensionsOnRestart':
                window.electron.store.set('settings.saveWindowDimensionsOnRestart', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.saveWindowDimensions', { status: statusLabel }))
                break
        }
        setApp((prevApp: SettingsInterface) => {
            const updatedSettings = { ...prevApp.settings }
            switch (type) {
                case 'autoTray':
                    updatedSettings.autoStartInTray = status
                    break
                case 'autoStart':
                    updatedSettings.autoStartApp = status
                    break
                case 'autoStartMusic':
                    updatedSettings.autoStartMusic = status
                    break
                case 'askSavePath':
                    updatedSettings.askSavePath = status
                    break
                case 'saveAsMp3':
                    updatedSettings.saveAsMp3 = status
                    break
                case 'closeAppInTray':
                    updatedSettings.closeAppInTray = status
                    break
                case 'deletePextAfterImport':
                    updatedSettings.deletePextAfterImport = status
                    break
                case 'hardwareAcceleration':
                    updatedSettings.hardwareAcceleration = status
                    break
                case 'devSocket':
                    updatedSettings.devSocket = status
                    break
                case 'showModModalAfterInstall':
                    updatedSettings.showModModalAfterInstall = status
                    break
                case 'saveWindowPositionOnRestart':
                    updatedSettings.saveWindowPositionOnRestart = status
                    break
                case 'saveWindowDimensionsOnRestart':
                    updatedSettings.saveWindowDimensionsOnRestart = status
                    break
            }
            return {
                ...prevApp,
                settings: updatedSettings
            }
        })
    }

    const setLanguage = async (language: string) => {
        if (app.settings.language === language) return
        await i18n.changeLanguage(language)
        window.electron.store.set('settings.language', language)
        setApp((prevApp: SettingsInterface) => ({
            ...prevApp,
            settings: { ...prevApp.settings, language }
        }))
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
                {t('contextMenu.appDirectory')}
            </button>,
        ),
        createButtonSection(t('contextMenu.obsWidget.title'), [
            {
                label: t('contextMenu.obsWidget.download', {
                    status: widgetInstalled ? t('contextMenu.status.installed') : t('contextMenu.status.notInstalled'),
                }),
                onClick: downloadObsWidget,
                disabled: widgetInstalled,
            },
            {
                label: t('contextMenu.obsWidget.openFolder'),
                onClick: () => window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'obsWidgetPath' }),
                disabled: !widgetInstalled,
            },
            {
                label: t('contextMenu.obsWidget.copyPath'),
                onClick: copyWidgetPath,
                disabled: !widgetInstalled,
            },
            {
                label: t('contextMenu.obsWidget.remove'),
                onClick: removeObsWidget,
                disabled: !widgetInstalled,
            },
        ]),
        createButtonSection(t('contextMenu.mod.title'), [
            {
                label:
                    app.mod.installed && app.mod.version
                        ? `${app.mod.name || t('contextMenu.mod.defaultName')} v${app.mod.version}`
                        : t('contextMenu.mod.notInstalled'),
                onClick: () => store.dispatch(openModal()),
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: t('contextMenu.mod.remove'),
                onClick: deleteMod,
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: t('contextMenu.mod.checkUpdates'),
                onClick: () => window.getModInfo(app),
                disabled: !app.mod.installed || !app.mod.version,
            },
            {
                label: t('contextMenu.mod.clearCache'),
                onClick: clearModCache,
            },
            createToggleButton(t('contextMenu.mod.showChangelog'), app.settings.showModModalAfterInstall, () =>
                toggleSetting('showModModalAfterInstall', !app.settings.showModModalAfterInstall),
            ),
        ]),
        createButtonSection(t('contextMenu.appSettings.title'), [
            createToggleButton(t('contextMenu.appSettings.autoStartApp'), app.settings.autoStartApp, () =>
                toggleSetting('autoStart', !app.settings.autoStartApp),
            ),
            createToggleButton(t('contextMenu.appSettings.hardwareAcceleration'), app.settings.hardwareAcceleration, () =>
                toggleSetting('hardwareAcceleration', !app.settings.hardwareAcceleration),
            ),
            createToggleButton(t('contextMenu.appSettings.deletePextAfterImport'), app.settings.deletePextAfterImport, () =>
                toggleSetting('deletePextAfterImport', !app.settings.deletePextAfterImport),
            ),
        ]),
        createButtonSection(t('contextMenu.windowSettings.title'), [
            createToggleButton(t('contextMenu.windowSettings.saveWindowDimensions'), app.settings.saveWindowDimensionsOnRestart, () =>
                toggleSetting('saveWindowDimensionsOnRestart', !app.settings.saveWindowDimensionsOnRestart),
            ),
            createToggleButton(t('contextMenu.windowSettings.saveWindowPosition'), app.settings.saveWindowPositionOnRestart, () =>
                toggleSetting('saveWindowPositionOnRestart', !app.settings.saveWindowPositionOnRestart),
            ),
            createToggleButton(t('contextMenu.windowSettings.autoTray'), app.settings.autoStartInTray, () =>
                toggleSetting('autoTray', !app.settings.autoStartInTray),
            ),
            createToggleButton(t('contextMenu.windowSettings.hideOnClose'), app.settings.closeAppInTray, () =>
                toggleSetting('closeAppInTray', !app.settings.closeAppInTray),
            ),
        ]),
        createButtonSection(t('contextMenu.language.title'), [
            createToggleButton(t('contextMenu.language.russian'), app.settings.language === 'ru', () => setLanguage('ru')),
            createToggleButton(t('contextMenu.language.english'), app.settings.language === 'en', () => setLanguage('en')),
        ]),
        createButtonSection(t('contextMenu.misc.title'), [
            { label: t('contextMenu.misc.version', { version: app.info.version, branch: window.appInfo.getBranch() }), onClick: openUpdateModal },
            {
                label: t('contextMenu.misc.checkUpdates'),
                onClick: () => window.desktopEvents?.send(MainEvents.CHECK_UPDATE),
            },
            {
                label: t('contextMenu.misc.collectLogs'),
                onClick: () => {
                    window.desktopEvents?.send(MainEvents.GET_LOG_ARCHIVE)
                    toast.custom('success', t('common.doneTitle'), t('contextMenu.misc.logsReady'))
                },
            },
            createToggleButton(
                t('contextMenu.misc.websocketStatus'),
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
