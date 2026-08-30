import { useContext, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import config from '@common/appConfig'
import { STABLE_MOD_SOURCE } from '@common/types/modSource'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { useModalContext } from '@app/providers/modal'
import { installModRelease, prepareModReleaseUpdate } from '@entities/mod/lib/installModRelease'
import userContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import type { ModSourceCatalog, ModSourceSelection } from '@common/types/modSource'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type SettingsInterface from '@entities/settings/model/settings.interface'

export type UpdateSource = 'backend' | 'github'
type UpdateStatus = 'IDLE' | 'CHECKING' | 'DOWNLOADING' | 'DOWNLOADED'

export function useSettingsActions(enabled: boolean) {
    const { t, i18n } = useTranslation()
    const { app, setApp, widgetInstalled, setWidgetInstalled, isAutonomousMode, checkModUpdates } = useContext(userContext)
    const { Modals, openModal } = useModalContext()
    const { isExperimentEnabled } = useExperiments()
    const widgetDownloadToastIdRef = useRef<string | null>(null)
    const [updateSource, setUpdateSourceState] = useState<UpdateSource>('backend')
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('IDLE')
    const [desktopRuntime, setDesktopRuntime] = useState({ isLinux: false })
    const [modSourceCatalog, setModSourceCatalog] = useState<ModSourceCatalog>({
        branches: [],
        selected: app.settings.modSource || STABLE_MOD_SOURCE,
    })
    const [modSourceLoading, setModSourceLoading] = useState(false)

    const subscriptionPageEnabled = isExperimentEnabled(CLIENT_EXPERIMENTS.WebSubscriptionsPage, false)
    const canResetAsarPath = desktopRuntime.isLinux && Boolean(app.settings.modSavePath)
    const updateSourceSwitchBlocked = updateStatus === 'CHECKING' || updateStatus === 'DOWNLOADING'

    const openAppDirectory = () => desktopApi.system.openAppDirectory()
    const openObsWidgetDirectory = () => desktopApi.system.openObsWidgetDirectory()
    const openSubscriptionPage = () => desktopApi.system.openExternal(`${config.WEBSITE_URL}/subscription`)
    const openBoostyUrl = () => desktopApi.system.openExternal(config.BOOSTY_URL)

    const resetAsarPath = () => {
        if (!desktopRuntime.isLinux) return
        void desktopApi.settings.updatePreferences({ modSavePath: '' })
        toast.custom('success', t('common.doneTitle'), t('contextMenu.mod.resetAsarPathSuccess'))
    }

    const deleteMod = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('mod.removing'))

        const handleFailure = (args: any) => {
            toast.custom('error', t('common.somethingWrongTitle'), t('mod.removeError', { message: args.error }), { id: toastId })
            if (args?.type === 'linux_permissions_required' && desktopRuntime.isLinux) {
                openModal(Modals.LINUX_PERMISSIONS_MODAL)
            }
        }

        const handleSuccess = () => {
            toast.custom('success', t('common.doneTitle'), t('mod.removedSuccess'), { id: toastId })
            setApp((previous: SettingsInterface) => {
                const updated = {
                    ...previous,
                    mod: { ...previous.mod, installed: false, version: '' },
                }
                void checkModUpdates(updated, { silentNotInstalled: true })
                void desktopApi.settings.resetModState()
                return updated
            })
        }

        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}
        unsubscribeSuccess = desktopApi.mods.onRemoveSuccess(() => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleSuccess()
        })
        unsubscribeFailure = desktopApi.mods.onRemoveFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            handleFailure(payload)
        })

        desktopApi.mods.remove()
        window.localStorage.removeItem('lastNotifiedModVersion')
    }

    const downloadObsWidget = () => {
        const handleProgress = ({ progress }: { progress: number }) => {
            if (widgetDownloadToastIdRef.current) {
                toast.update(widgetDownloadToastIdRef.current, {
                    kind: 'loading',
                    title: t('obsWidget.downloading'),
                    msg: t('layout.downloadProgressLabel'),
                    value: progress,
                })
            } else {
                widgetDownloadToastIdRef.current = toast.custom(
                    'loading',
                    t('obsWidget.downloading'),
                    t('layout.downloadProgressLabel'),
                    { duration: Infinity },
                    progress,
                )
            }
        }

        let unsubscribeProgress = () => {}
        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}
        const cleanup = () => {
            unsubscribeProgress()
            unsubscribeSuccess()
            unsubscribeFailure()
        }

        unsubscribeProgress = desktopApi.widgets.onDownloadProgress(payload => handleProgress(payload as { progress: number }))
        unsubscribeSuccess = desktopApi.widgets.onDownloadSuccess(() => {
            cleanup()
            if (widgetDownloadToastIdRef.current) {
                toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'), { id: widgetDownloadToastIdRef.current })
                widgetDownloadToastIdRef.current = null
            } else {
                toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'))
            }
            setWidgetInstalled(true)
        })
        unsubscribeFailure = desktopApi.widgets.onDownloadFailure(payload => {
            const error = (payload as { error?: string }).error
            cleanup()
            if (widgetDownloadToastIdRef.current) {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: error }), {
                    id: widgetDownloadToastIdRef.current,
                })
                widgetDownloadToastIdRef.current = null
            } else {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: error }))
            }
        })
        desktopApi.widgets.downloadObs()
    }

    const removeObsWidget = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('obsWidget.removing'))
        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}

        unsubscribeSuccess = desktopApi.widgets.onRemoveSuccess(() => {
            unsubscribeSuccess()
            unsubscribeFailure()
            toast.custom('success', t('common.doneTitle'), t('obsWidget.removeSuccess'), { id: toastId })
            setWidgetInstalled(false)
        })
        unsubscribeFailure = desktopApi.widgets.onRemoveFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            toast.custom('error', t('common.errorTitle'), t('obsWidget.removeError', { message: (payload as { error?: string }).error }), {
                id: toastId,
            })
        })
        desktopApi.widgets.removeObs()
    }

    const clearModCache = () => {
        const toastId = toast.custom('info', t('common.waitTitle'), t('mod.cacheClearing'))
        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}

        unsubscribeSuccess = desktopApi.mods.onClearCacheSuccess(() => {
            unsubscribeSuccess()
            unsubscribeFailure()
            toast.custom('success', t('common.doneTitle'), t('mod.cacheCleared'), { id: toastId })
        })
        unsubscribeFailure = desktopApi.mods.onClearCacheFailure(payload => {
            unsubscribeSuccess()
            unsubscribeFailure()
            toast.custom('error', t('common.errorTitle'), t('mod.cacheClearError', { message: (payload as { error?: string }).error }), {
                id: toastId,
            })
        })
        desktopApi.mods.clearCache()
    }

    const copyWidgetPath = async () => {
        try {
            const widgetPath = await desktopApi.widgets.getObsPath()
            if (!widgetPath) {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.pathFetchError'))
                return
            }
            await desktopApi.system.writeClipboardText(widgetPath)
            toast.custom('success', t('common.doneTitle'), t('obsWidget.pathCopied'))
        } catch {
            toast.custom('error', t('common.errorTitle'), t('obsWidget.pathCopyError'))
        }
    }

    const toggleSetting = (type: string, status: boolean) => {
        const statusLabel = status ? t('common.enabled') : t('common.disabled')
        const preferenceByType: Record<string, Record<string, boolean>> = {
            autoTray: { autoStartInTray: status },
            autoStart: { autoStartApp: status },
            autoStartMusic: { autoStartMusic: status },
            askSavePath: { askSavePath: status },
            saveAsMp3: { saveAsMp3: status },
            closeAppInTray: { closeAppInTray: status },
            deletePextAfterImport: { deletePextAfterImport: status },
            autoUpdateStoreAddons: { autoUpdateStoreAddons: status },
            hardwareAcceleration: { hardwareAcceleration: status },
            showModModalAfterInstall: { showModModalAfterInstall: status },
            saveWindowPositionOnRestart: { saveWindowPositionOnRestart: status },
            saveWindowDimensionsOnRestart: { saveWindowDimensionsOnRestart: status },
        }
        const preference = preferenceByType[type]
        if (!preference) return

        void desktopApi.settings.updatePreferences(preference)

        const toastKeyByType: Record<string, string> = {
            autoTray: 'settings.toggles.autoTray',
            autoStart: 'settings.toggles.autoStartApp',
            autoStartMusic: 'settings.toggles.autoStartMusic',
            askSavePath: 'settings.toggles.askSavePath',
            saveAsMp3: 'settings.toggles.saveAsMp3',
            closeAppInTray: 'settings.toggles.closeAppInTray',
            deletePextAfterImport: 'settings.toggles.deletePextAfterImport',
            autoUpdateStoreAddons: 'settings.toggles.autoUpdateStoreAddons',
            showModModalAfterInstall: 'settings.toggles.showModChangelog',
            saveWindowPositionOnRestart: 'settings.toggles.saveWindowPosition',
            saveWindowDimensionsOnRestart: 'settings.toggles.saveWindowDimensions',
        }
        const message = type === 'hardwareAcceleration' ? t('settings.restartRequired') : t(toastKeyByType[type], { status: statusLabel })
        toast.custom('success', t('common.doneTitle'), message)

        setApp((previous: SettingsInterface) => ({
            ...previous,
            settings: { ...previous.settings, ...preference },
        }))
    }

    const setLanguage = async (language: string) => {
        if (app.settings.language === language) return
        await i18n.changeLanguage(language)
        await desktopApi.settings.setLanguage(language)
        setApp((previous: SettingsInterface) => ({
            ...previous,
            settings: { ...previous.settings, language },
        }))
    }

    const collectLogs = () => {
        desktopApi.system.createLogArchive()
        toast.custom('success', t('common.doneTitle'), t('contextMenu.misc.logsReady'))
    }

    useEffect(() => {
        if (!enabled) return

        void Promise.all([desktopApi.updates.getSource(), desktopApi.updates.getStatus()])
            .then(([nextSource, nextStatus]) => {
                setUpdateSourceState((nextSource as UpdateSource) || 'backend')
                setUpdateStatus((nextStatus as UpdateStatus) || 'IDLE')
            })
            .catch(() => {
                setUpdateSourceState('backend')
                setUpdateStatus('IDLE')
            })

        const unsubscribers = [
            desktopApi.updates.onCheck(payload => {
                const data = payload as { checking?: boolean; updateAvailable?: boolean }
                if (data?.checking) setUpdateStatus('CHECKING')
                else if (!data?.updateAvailable) setUpdateStatus('IDLE')
            }),
            desktopApi.updates.onDownloadProgress(() => setUpdateStatus('DOWNLOADING')),
            desktopApi.updates.onDownloadFinished(() => setUpdateStatus('DOWNLOADED')),
            desktopApi.updates.onDownloadFailed(() => setUpdateStatus('IDLE')),
        ].filter(Boolean) as Array<() => void>

        return () => unsubscribers.forEach(unsubscribe => unsubscribe())
    }, [enabled])

    useEffect(() => {
        if (!enabled) return

        let active = true
        setModSourceLoading(true)
        void desktopApi.mods
            .getSources()
            .then(catalog => {
                if (active) setModSourceCatalog(catalog)
            })
            .catch(error => {
                console.error('[Settings] Failed to load mod sources', error)
                if (active) toast.custom('error', t('common.errorTitle'), t('contextMenu.mod.sourceLoadError'))
            })
            .finally(() => {
                if (active) setModSourceLoading(false)
            })

        return () => {
            active = false
        }
    }, [enabled, t])

    useEffect(() => {
        if (!enabled) return
        let active = true
        void desktopApi.getRuntimeInfo().then(runtimeInfo => {
            if (active) setDesktopRuntime({ isLinux: runtimeInfo.isLinux })
        })
        return () => {
            active = false
        }
    }, [enabled])

    const setReleaseSource = async (nextSource: UpdateSource) => {
        if (nextSource === updateSource) return
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
        } catch (error) {
            const isBusy = error instanceof Error && error.message === 'UPDATE_SOURCE_BUSY'
            toast.custom('error', t('common.errorTitle'), isBusy ? t('contextMenu.updates.busy') : t('contextMenu.updates.sourceChangeError'))
        }
    }

    const setModSource = async (selection: ModSourceSelection) => {
        const selected = modSourceCatalog.selected
        if (selected.type === selection.type && selected.branch === selection.branch) return

        setModSourceLoading(true)
        try {
            const response = await desktopApi.mods.selectSource(selection)
            const release = response.release as ModInterface | undefined
            if (!release?.downloadUrl) throw new Error('MOD_SOURCE_UNAVAILABLE')

            const nextApp: SettingsInterface = {
                ...app,
                settings: {
                    ...app.settings,
                    modSource: response.selection,
                },
            }
            setApp(nextApp)
            setModSourceCatalog(previous => ({ ...previous, selected: response.selection }))
            if (app.mod.installed && app.mod.version) {
                prepareModReleaseUpdate(release)
            } else {
                installModRelease(release)
            }
            void checkModUpdates(nextApp, { silentNotInstalled: true })
        } catch (error) {
            console.error('[Settings] Failed to switch mod source', error)
            toast.custom('error', t('common.errorTitle'), t('contextMenu.mod.sourceChangeError'))
        } finally {
            setModSourceLoading(false)
        }
    }

    return {
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
        modSourceCatalog,
        modSourceLoading,
        openAppDirectory,
        openBoostyUrl,
        openObsWidgetDirectory,
        openSubscriptionPage,
        openUpdateChannelModal: () => openModal(Modals.UPDATE_CHANNEL_OVERRIDE),
        openAppChangelog: () => openModal(Modals.APP_CHANGELOG),
        openModChangelog: () => openModal(Modals.MOD_CHANGELOG),
        removeObsWidget,
        resetAsarPath,
        setLanguage,
        setModSource,
        setReleaseSource,
        subscriptionPageEnabled,
        toggleSetting,
        updateSource,
        updateSourceSwitchBlocked,
        widgetInstalled,
    }
}
