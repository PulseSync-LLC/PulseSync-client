import React, { useContext, useRef } from 'react'
import { motion } from 'framer-motion'
import * as menuStyles from '@features/context_menu/context_menu.module.scss'
import userContext from '@entities/user/model/context'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import toast from '@shared/ui/toast'
import SettingsInterface from '@entities/settings/model/settings.interface'
import { useModalContext } from '@app/providers/modal'
import { useTranslation } from 'react-i18next'
import { buildContextMenuSections, renderContextMenuSections } from '@features/context_menu/model/contextMenuSections'

interface ContextMenuProps {
    modalRef: React.RefObject<{
        openUpdateModal: () => void
        closeUpdateModal: () => void
    } | null>
}

const ContextMenu: React.FC<ContextMenuProps> = ({ modalRef }) => {
    const { t, i18n } = useTranslation()
    const { app, setApp, widgetInstalled, setWidgetInstalled } = useContext(userContext)
    const { Modals, openModal } = useModalContext()
    const widgetDownloadToastIdRef = useRef<string | null>(null)

    const openUpdateModal = () => {
        modalRef.current?.openUpdateModal()
    }

    const openAppDirectory = () => {
        window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'appPath' })
    }

    const canResetAsarPath = window.electron.isLinux() && Boolean(window.electron.store.get('settings.modSavePath'))

    const resetAsarPath = () => {
        if (!window.electron.isLinux()) return
        window.electron.store.set('settings.modSavePath', '')
        toast.custom('success', t('common.doneTitle'), t('contextMenu.mod.resetAsarPathSuccess'))
    }

    const showLoadingToast = (event: any, message: string) => {
        const toastId = toast.custom('info', t('common.waitTitle'), message)

        const handleFailure = (event: any, args: any) => {
            toast.custom('error', t('common.somethingWrongTitle'), t('mod.removeError', { message: args.error }), {
                id: toastId,
            })
            if (args?.type === 'linux_permissions_required' && window.electron.isLinux()) {
                openModal(Modals.LINUX_PERMISSIONS_MODAL)
            }
        }

        const handleSuccess = (event: any, args: any) => {
            toast.custom('success', t('common.doneTitle'), t('mod.removedSuccess'), {
                id: toastId,
            })
            setApp((prevApp: SettingsInterface) => {
                const updatedApp = {
                    ...prevApp,
                    mod: {
                        ...prevApp.mod,
                        installed: false,
                        version: '',
                    },
                }
                window.getModInfo(updatedApp, { silentNotInstalled: true })
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
        const handleProgress = (_: any, { progress }: { progress: number }) => {
            if (widgetDownloadToastIdRef.current) {
                toast.update(widgetDownloadToastIdRef.current, {
                    kind: 'loading',
                    title: t('obsWidget.downloading'),
                    msg: t('layout.downloadProgressLabel'),
                    value: progress,
                })
            } else {
                const id = toast.custom('loading', t('obsWidget.downloading'), t('layout.downloadProgressLabel'), { duration: Infinity }, progress)
                widgetDownloadToastIdRef.current = id
            }
        }

        const cleanupListeners = () => {
            window.desktopEvents?.removeListener(RendererEvents.DOWNLOAD_OBS_WIDGET_PROGRESS, handleProgress)
        }

        const handleSuccess = () => {
            cleanupListeners()
            if (widgetDownloadToastIdRef.current) {
                toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'), { id: widgetDownloadToastIdRef.current })
                widgetDownloadToastIdRef.current = null
            } else {
                toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'))
            }
            setWidgetInstalled(true)
        }

        const handleFailure = (event: any, args: any) => {
            cleanupListeners()
            if (widgetDownloadToastIdRef.current) {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: args.error }), {
                    id: widgetDownloadToastIdRef.current,
                })
                widgetDownloadToastIdRef.current = null
            } else {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: args.error }))
            }
        }

        window.desktopEvents?.on(RendererEvents.DOWNLOAD_OBS_WIDGET_PROGRESS, handleProgress)
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
            case 'autoUpdateStoreAddons':
                window.electron.store.set('settings.autoUpdateStoreAddons', status)
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoUpdateStoreAddons', { status: statusLabel }))
                break
            case 'hardwareAcceleration':
                window.electron.store.set('settings.hardwareAcceleration', status)
                toast.custom('success', t('common.doneTitle'), t('settings.restartRequired'))
                break
            case 'devSocket':
                window.electron.store.set('settings.devSocket', status)
                console.log(status)
                status ? window.desktopEvents?.send(MainEvents.WEBSOCKET_START) : window.desktopEvents?.send(MainEvents.WEBSOCKET_STOP)
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
                case 'autoUpdateStoreAddons':
                    updatedSettings.autoUpdateStoreAddons = status
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
                settings: updatedSettings,
            }
        })
    }

    const setLanguage = async (language: string) => {
        if (app.settings.language === language) return
        await i18n.changeLanguage(language)
        window.electron.store.set('settings.language', language)
        setApp((prevApp: SettingsInterface) => ({
            ...prevApp,
            settings: { ...prevApp.settings, language },
        }))
    }

    const collectLogs = () => {
        window.desktopEvents?.send(MainEvents.GET_LOG_ARCHIVE)
        toast.custom('success', t('common.doneTitle'), t('contextMenu.misc.logsReady'))
    }

    const buttonConfigs = buildContextMenuSections({
        app,
        canResetAsarPath,
        clearModCache,
        collectLogs,
        copyWidgetPath,
        deleteMod,
        downloadObsWidget,
        openAppDirectory,
        openModal,
        openUpdateModal,
        removeObsWidget,
        resetAsarPath,
        setLanguage,
        t,
        toggleSetting,
        widgetInstalled,
        modals: {
            MOD_CHANGELOG: Modals.MOD_CHANGELOG,
        },
    })

    return (
        <motion.div
            className={menuStyles.modMenu}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
        >
            {renderContextMenuSections(buttonConfigs)}
        </motion.div>
    )
}

export default ContextMenu
