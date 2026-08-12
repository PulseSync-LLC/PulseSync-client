import React, { useContext, useRef } from 'react'
import { motion } from 'framer-motion'
import * as menuStyles from '@features/context_menu/context_menu.module.scss'
import userContext from '@entities/user/model/context'

import toast from '@shared/ui/toast'
import SettingsInterface from '@entities/settings/model/settings.interface'
import { useModalContext } from '@app/providers/modal'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { useTranslation } from 'react-i18next'
import { buildContextMenuSections, renderContextMenuSections } from '@features/context_menu/model/contextMenuSections'
import config from '@common/appConfig'
import { desktopApi } from '@shared/desktop/desktopApi'

interface ContextMenuProps {
    modalRef: React.RefObject<{
        openUpdateModal: () => void
        closeUpdateModal: () => void
    } | null>
}

type UpdateSource = 'backend' | 'github'
type UpdateStatus = 'IDLE' | 'CHECKING' | 'DOWNLOADING' | 'DOWNLOADED'

const ContextMenu: React.FC<ContextMenuProps> = ({ modalRef }) => {
    const { t, i18n } = useTranslation()
    const { app, setApp, widgetInstalled, setWidgetInstalled, isAutonomousMode, checkModUpdates } = useContext(userContext)
    const { Modals, openModal } = useModalContext()
    const { isExperimentEnabled } = useExperiments()
    const widgetDownloadToastIdRef = useRef<string | null>(null)
    const [updateSource, setUpdateSourceState] = React.useState<UpdateSource>('backend')
    const [updateStatus, setUpdateStatus] = React.useState<UpdateStatus>('IDLE')
    const [desktopRuntime, setDesktopRuntime] = React.useState({ isLinux: false })
    const subscriptionPageEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.WebSubscriptionsPage, false)

    const openUpdateModal = () => {
        modalRef.current?.openUpdateModal()
    }

    const openUpdateChannelModal = () => {
        openModal(Modals.UPDATE_CHANNEL_OVERRIDE)
    }

    const openSettings = () => {
        openModal(Modals.SETTINGS)
    }

    const openAppDirectory = () => {
        desktopApi.system.openAppDirectory()
    }

    const openObsWidgetDirectory = () => {
        desktopApi.system.openObsWidgetDirectory()
    }

    const openSubscriptionPage = () => {
        desktopApi.system.openExternal(`${config.WEBSITE_URL}/subscription`)
    }

    const openBoostyUrl = () => {
        desktopApi.system.openExternal(config.BOOSTY_URL)
    }

    const canResetAsarPath = desktopRuntime.isLinux && Boolean(app.settings.modSavePath)
    const updateSourceSwitchBlocked = updateStatus === 'CHECKING' || updateStatus === 'DOWNLOADING'

    const resetAsarPath = () => {
        if (!desktopRuntime.isLinux) return
        void desktopApi.settings.updatePreferences({ modSavePath: '' })
        toast.custom('success', t('common.doneTitle'), t('contextMenu.mod.resetAsarPathSuccess'))
    }

    const showLoadingToast = (event: any, message: string) => {
        const toastId = toast.custom('info', t('common.waitTitle'), message)

        const handleFailure = (args: any) => {
            toast.custom('error', t('common.somethingWrongTitle'), t('mod.removeError', { message: args.error }), {
                id: toastId,
            })
            if (args?.type === 'linux_permissions_required' && desktopRuntime.isLinux) {
                openModal(Modals.LINUX_PERMISSIONS_MODAL)
            }
        }

        const handleSuccess = () => {
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
                void checkModUpdates(updatedApp, { silentNotInstalled: true })
                void desktopApi.settings.resetModState()
                return updatedApp
            })
        }

        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}
        unsubscribeSuccess = desktopApi.mods.onRemoveSuccess(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleSuccess()
        })
        unsubscribeFailure = desktopApi.mods.onRemoveFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleFailure(payload)
        })
    }

    const deleteMod = (e: any) => {
        showLoadingToast(e, t('mod.removing'))
        desktopApi.mods.remove()
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

        let unsubscribeProgress = () => {}
        const cleanupListeners = () => unsubscribeProgress()

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

        const handleFailure = (args: any) => {
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

        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}
        unsubscribeProgress = desktopApi.widgets.onDownloadProgress(payload => handleProgress(null, payload as { progress: number }))
        unsubscribeSuccess = desktopApi.widgets.onDownloadSuccess(() => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleSuccess()
        })
        unsubscribeFailure = desktopApi.widgets.onDownloadFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleFailure(payload)
        })
        desktopApi.widgets.downloadObs()
    }

    const removeObsWidget = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('obsWidget.removing'))

        const handleSuccess = () => {
            toast.custom('success', t('common.doneTitle'), t('obsWidget.removeSuccess'), { id: toastId })
            setWidgetInstalled(false)
        }

        const handleFailure = (args: any) => {
            toast.custom('error', t('common.errorTitle'), t('obsWidget.removeError', { message: args.error }), { id: toastId })
        }

        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}
        unsubscribeSuccess = desktopApi.widgets.onRemoveSuccess(() => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleSuccess()
        })
        unsubscribeFailure = desktopApi.widgets.onRemoveFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleFailure(payload)
        })
        desktopApi.widgets.removeObs()
    }

    const clearModCache = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('mod.cacheClearing'))

        const handleSuccess = () => {
            toast.custom('success', t('common.doneTitle'), t('mod.cacheCleared'), { id: toastId })
        }

        const handleFailure = (args: any) => {
            toast.custom('error', t('common.errorTitle'), t('mod.cacheClearError', { message: args.error }), { id: toastId })
        }

        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}
        unsubscribeSuccess = desktopApi.mods.onClearCacheSuccess(() => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleSuccess()
        })
        unsubscribeFailure = desktopApi.mods.onClearCacheFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleFailure(payload)
        })
        desktopApi.mods.clearCache()
    }

    const copyWidgetPath = async () => {
        try {
            const widgetPath = await desktopApi.widgets.getObsPath()
            if (widgetPath) {
                await desktopApi.system.writeClipboardText(widgetPath)
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
                void desktopApi.settings.updatePreferences({ autoStartInTray: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoTray', { status: statusLabel }))
                break
            case 'autoStart':
                void desktopApi.settings.updatePreferences({ autoStartApp: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoStartApp', { status: statusLabel }))
                break
            case 'autoStartMusic':
                void desktopApi.settings.updatePreferences({ autoStartMusic: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoStartMusic', { status: statusLabel }))
                break
            case 'askSavePath':
                void desktopApi.settings.updatePreferences({ askSavePath: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.askSavePath', { status: statusLabel }))
                break
            case 'saveAsMp3':
                void desktopApi.settings.updatePreferences({ saveAsMp3: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.saveAsMp3', { status: statusLabel }))
                break
            case 'closeAppInTray':
                void desktopApi.settings.updatePreferences({ closeAppInTray: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.closeAppInTray', { status: statusLabel }))
                break
            case 'deletePextAfterImport':
                void desktopApi.settings.updatePreferences({ deletePextAfterImport: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.deletePextAfterImport'))
                break
            case 'autoUpdateStoreAddons':
                void desktopApi.settings.updatePreferences({ autoUpdateStoreAddons: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.autoUpdateStoreAddons', { status: statusLabel }))
                break
            case 'hardwareAcceleration':
                void desktopApi.settings.updatePreferences({ hardwareAcceleration: status })
                toast.custom('success', t('common.doneTitle'), t('settings.restartRequired'))
                break
            case 'showModModalAfterInstall':
                void desktopApi.settings.updatePreferences({ showModModalAfterInstall: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.showModChangelog', { status: statusLabel }))
                break
            case 'saveWindowPositionOnRestart':
                void desktopApi.settings.updatePreferences({ saveWindowPositionOnRestart: status })
                toast.custom('success', t('common.doneTitle'), t('settings.toggles.saveWindowPosition', { status: statusLabel }))
                break
            case 'saveWindowDimensionsOnRestart':
                void desktopApi.settings.updatePreferences({ saveWindowDimensionsOnRestart: status })
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
        await desktopApi.settings.setLanguage(language)
        setApp((prevApp: SettingsInterface) => ({
            ...prevApp,
            settings: { ...prevApp.settings, language },
        }))
    }

    const collectLogs = () => {
        desktopApi.system.createLogArchive()
        toast.custom('success', t('common.doneTitle'), t('contextMenu.misc.logsReady'))
    }

    React.useEffect(() => {
        const loadUpdateState = async () => {
            try {
                const [nextSource, nextStatus] = await Promise.all([desktopApi.updates.getSource(), desktopApi.updates.getStatus()])

                setUpdateSourceState((nextSource as UpdateSource) || 'backend')
                setUpdateStatus((nextStatus as UpdateStatus) || 'IDLE')
            } catch {
                setUpdateSourceState('backend')
                setUpdateStatus('IDLE')
            }
        }

        void loadUpdateState()

        const handleCheckUpdate = (_event: unknown, data?: { checking?: boolean; updateAvailable?: boolean }) => {
            if (data?.checking) {
                setUpdateStatus('CHECKING')
                return
            }

            if (!data?.updateAvailable) {
                setUpdateStatus('IDLE')
            }
        }

        const handleDownloadProgress = () => setUpdateStatus('DOWNLOADING')
        const handleDownloadFinished = () => setUpdateStatus('DOWNLOADED')
        const handleDownloadFailed = () => setUpdateStatus('IDLE')

        const unsubscribers = [
            desktopApi.updates.onCheck(payload => handleCheckUpdate(null, payload as { checking?: boolean; updateAvailable?: boolean })),
            desktopApi.updates.onDownloadProgress(handleDownloadProgress),
            desktopApi.updates.onDownloadFinished(handleDownloadFinished),
            desktopApi.updates.onDownloadFailed(handleDownloadFailed),
        ].filter(Boolean) as Array<() => void>

        return () => {
            unsubscribers.forEach(unsubscribe => unsubscribe())
        }
    }, [])

    React.useEffect(() => {
        let mounted = true
        desktopApi.getRuntimeInfo().then(runtimeInfo => {
            if (!mounted) return
            setDesktopRuntime({ isLinux: runtimeInfo.isLinux })
        })
        return () => {
            mounted = false
        }
    }, [])

    const setReleaseSource = async (nextSource: UpdateSource) => {
        if (nextSource === updateSource) {
            return
        }

        try {
            const response = (await desktopApi.updates.setSource(nextSource)) as { source?: UpdateSource } | undefined
            const appliedSource = response?.source || nextSource
            setUpdateSourceState(appliedSource)
            toast.custom(
                'success',
                t('common.doneTitle'),
                t('contextMenu.updates.sourceChanged', { source: t(`contextMenu.updates.${appliedSource}`) }),
            )
            desktopApi.updates.check({ manual: true })
            void checkModUpdates(app, { silentNotInstalled: true })
        } catch (error: any) {
            const isBusy = error instanceof Error && error.message === 'UPDATE_SOURCE_BUSY'
            toast.custom('error', t('common.errorTitle'), isBusy ? t('contextMenu.updates.busy') : t('contextMenu.updates.sourceChangeError'))
        }
    }

    const buttonConfigs = buildContextMenuSections({
        app,
        canResetAsarPath,
        checkAppUpdates: () => desktopApi.updates.check({ manual: true }),
        checkModUpdates: () => checkModUpdates(app, { manual: true }),
        clearModCache,
        collectLogs,
        copyWidgetPath,
        deleteMod,
        downloadObsWidget,
        isAutonomousMode,
        isLinux: desktopRuntime.isLinux,
        openAppDirectory,
        openBoostyUrl,
        openSettings,
        openObsWidgetDirectory,
        openSubscriptionPage,
        subscriptionPageEnabled,
        openUpdateChannelModal,
        openModal,
        openUpdateModal,
        removeObsWidget,
        resetAsarPath,
        setLanguage,
        setUpdateSource: setReleaseSource,
        t,
        toggleSetting,
        updateSource,
        updateSourceSwitchBlocked,
        widgetInstalled,
        appBranch: app.info.branch,
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
