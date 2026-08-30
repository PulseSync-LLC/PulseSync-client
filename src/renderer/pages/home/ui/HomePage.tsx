import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import { useModalContext } from '@app/providers/modal'
import { type HomeSecondaryComponent, primaryComponents, secondaryComponents } from '@pages/home/model/homeDashboard'
import HomeNewsSection from '@pages/home/ui/HomeNewsSection'
import HomePrimaryComponentsSection, { type HomeBranchPicker } from '@pages/home/ui/HomePrimaryComponentsSection'
import HomeSecondaryComponentsSection from '@pages/home/ui/HomeSecondaryComponentsSection'
import PageLayout from '@widgets/layout/PageLayout'
import { installModRelease, prepareModReleaseUpdate } from '@entities/mod/lib/installModRelease'
import { isModReleaseUpdateAvailable } from '@entities/mod/lib/modReleaseUpdate'
import UserContext from '@entities/user/model/context'
import { desktopApi } from '@shared/desktop/desktopApi'
import toast from '@shared/ui/toast'

import * as styles from './home.module.scss'

import type { ModSourceCatalog, ModSourceSelection } from '@common/types/modSource'
import type { SubcomponentsMeta } from '@common/types/subcomponentsMeta'
import type { ModInterface } from '@entities/mod/model/modInterface'
import type SettingsInterface from '@entities/settings/model/settings.interface'

type BranchComponent = 'client' | 'mod'
type UpdateChannel = 'beta' | 'dev'
type ChannelSelection = UpdateChannel | 'default'
type UpdateStatus = 'IDLE' | 'CHECKING' | 'DOWNLOADING' | 'DOWNLOADED'

type ClientChannelState = {
    buildChannel: UpdateChannel
    effectiveChannel: UpdateChannel
    overrideChannel: UpdateChannel | null
}

const DEFAULT_CLIENT_CHANNEL_STATE: ClientChannelState = {
    buildChannel: 'beta',
    effectiveChannel: 'beta',
    overrideChannel: null,
}

const normalizeUpdateChannel = (value: unknown): UpdateChannel => (value === 'dev' ? 'dev' : 'beta')

export default function HomePage() {
    const { app, setApp, modInfo, musicInstalled, musicVersion, widgetInstalled, setWidgetInstalled, isAutonomousMode, checkModUpdates } =
        useContext(UserContext)
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()

    const [isObsInstalling, setIsObsInstalling] = useState(false)
    const [subcomponentsMeta, setSubcomponentsMeta] = useState<SubcomponentsMeta | undefined>(undefined)
    const [clientChannelState, setClientChannelState] = useState<ClientChannelState>(DEFAULT_CLIENT_CHANNEL_STATE)
    const [clientChannelSelection, setClientChannelSelection] = useState<ChannelSelection>('default')
    const [clientChannelLoading, setClientChannelLoading] = useState(true)
    const [clientUpdateStatus, setClientUpdateStatus] = useState<UpdateStatus>('IDLE')
    const [modSourceCatalog, setModSourceCatalog] = useState<ModSourceCatalog>({ branches: [], selected: app.settings.modSource })
    const [modSourceLoading, setModSourceLoading] = useState(false)
    const [modSourceLoaded, setModSourceLoaded] = useState(false)
    const widgetDownloadToastIdRef = useRef<string | null>(null)
    const allowDevToBetaSwitch = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientDevToBetaSwitch, false)

    const openAppChangelogModal = useCallback(() => openModal(Modals.APP_CHANGELOG), [Modals.APP_CHANGELOG, openModal])
    const openModModal = useCallback(() => openModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, openModal])
    const openYandexMusicChangelogModal = useCallback(
        () =>
            openModal(Modals.YANDEX_MUSIC_CHANGELOG, {
                currentVersion: musicVersion,
            }),
        [Modals.YANDEX_MUSIC_CHANGELOG, musicVersion, openModal],
    )

    useEffect(() => {
        let isMounted = true

        void desktopApi.system
            .getSubcomponentsMeta()
            .then(meta => {
                if (isMounted) {
                    setSubcomponentsMeta(meta as SubcomponentsMeta)
                }
            })
            .catch(error => {
                console.error('Failed to fetch subcomponents meta:', error)
            })

        return () => {
            isMounted = false
        }
    }, [])

    const loadClientChannels = useCallback(async () => {
        setClientChannelLoading(true)

        try {
            const [buildChannel, effectiveChannel, overrideChannel, updateStatus] = await Promise.all([
                desktopApi.updates.getBuildChannel(),
                desktopApi.updates.getEffectiveChannel(),
                desktopApi.updates.getChannelOverride(),
                desktopApi.updates.getStatus(),
            ])
            const nextState: ClientChannelState = {
                buildChannel: normalizeUpdateChannel(buildChannel),
                effectiveChannel: normalizeUpdateChannel(effectiveChannel),
                overrideChannel: overrideChannel === 'beta' || overrideChannel === 'dev' ? overrideChannel : null,
            }

            setClientChannelState(nextState)
            setClientChannelSelection(nextState.overrideChannel ?? 'default')
            const nextUpdateStatus = (updateStatus as UpdateStatus | null) ?? 'IDLE'
            setClientUpdateStatus(nextUpdateStatus)
        } catch (error) {
            console.error('[Home] Failed to load client update channels', error)
            toast.custom('error', t('common.errorTitleShort'), t('header.updateChannel.loadError'))
        } finally {
            setClientChannelLoading(false)
        }
    }, [t])

    const loadModSources = useCallback(async () => {
        if (modSourceLoading) return

        setModSourceLoading(true)
        try {
            const catalog = await desktopApi.mods.getSources()
            setModSourceCatalog(catalog)
            setModSourceLoaded(true)
        } catch (error) {
            console.error('[Home] Failed to load mod sources', error)
            toast.custom('error', t('common.errorTitle'), t('contextMenu.mod.sourceLoadError'))
        } finally {
            setModSourceLoading(false)
        }
    }, [modSourceLoading, t])

    useEffect(() => {
        void loadClientChannels()
    }, [loadClientChannels])

    useEffect(() => {
        const handleCheckUpdate = (payload?: { checking?: boolean; updateAvailable?: boolean }) => {
            if (payload?.checking) {
                setClientUpdateStatus('CHECKING')
                return
            }

            if (payload?.updateAvailable !== undefined) {
                if (!payload.updateAvailable) setClientUpdateStatus('IDLE')
            }
        }

        const handleDownloadProgress = () => {
            setClientUpdateStatus('DOWNLOADING')
        }
        const handleDownloadFinished = () => {
            setClientUpdateStatus('DOWNLOADED')
        }
        const handleDownloadFailed = () => {
            setClientUpdateStatus('IDLE')
        }
        const handleUpdateAvailable = () => {
            setClientUpdateStatus('DOWNLOADED')
        }

        const unsubscribers = [
            desktopApi.updates.onCheck(payload => handleCheckUpdate(payload as { checking?: boolean; updateAvailable?: boolean })),
            desktopApi.updates.onAvailable(handleUpdateAvailable),
            desktopApi.updates.onDownloadProgress(handleDownloadProgress),
            desktopApi.updates.onDownloadFinished(handleDownloadFinished),
            desktopApi.updates.onDownloadFailed(handleDownloadFailed),
        ]

        return () => unsubscribers.forEach(unsubscribe => unsubscribe())
    }, [])

    const primaryComponentVersions = useMemo<Record<string, string>>(
        () => ({
            music: (isAutonomousMode || musicInstalled) && musicVersion ? musicVersion : t('contextMenu.mod.notInstalled'),
            mod: app.mod.installed && app.mod.version ? app.mod.version : t('contextMenu.mod.notInstalled'),
            client: app.info.version || t('contextMenu.mod.notInstalled'),
        }),
        [app.info.version, app.mod.installed, app.mod.version, isAutonomousMode, musicInstalled, musicVersion, t],
    )

    const primaryComponentBranches = useMemo<Partial<Record<BranchComponent, string>>>(() => {
        const modBranch = app.mod.sourceType === 'branch' ? app.mod.branch.trim() : ''
        const clientBranch = clientChannelState.overrideChannel ? clientChannelState.effectiveChannel : ''

        return {
            ...(modBranch ? { mod: modBranch } : {}),
            ...(clientBranch ? { client: clientBranch } : {}),
        }
    }, [app.mod.branch, app.mod.sourceType, clientChannelState.effectiveChannel, clientChannelState.overrideChannel])

    const handleClientChannelSelect = useCallback(
        async (selection: string) => {
            const nextSelection = selection as ChannelSelection
            const nextEffectiveChannel = nextSelection === 'default' ? clientChannelState.buildChannel : nextSelection
            const nextOverride = nextSelection === 'default' || nextSelection === clientChannelState.buildChannel ? null : nextSelection
            if (nextOverride === clientChannelState.overrideChannel) return

            if (!allowDevToBetaSwitch && clientChannelState.effectiveChannel === 'dev' && nextEffectiveChannel === 'beta') {
                toast.custom('error', t('common.errorTitleShort'), t('header.updateChannel.switchDisabled'))
                return
            }

            setClientChannelLoading(true)
            try {
                const nextState = (await desktopApi.updates.setChannelOverride({
                    channel: nextOverride,
                    allowDevToBetaSwitch,
                })) as ClientChannelState

                setClientChannelState(nextState)
                setClientChannelSelection(nextState.overrideChannel ?? 'default')
                desktopApi.updates.check({ manual: true })
                toast.custom('success', t('common.successTitleShort'), t('header.updateChannel.saved', { channel: nextState.effectiveChannel }))
            } catch (error) {
                console.error('[Home] Failed to switch client update channel', error)
                toast.custom('error', t('common.errorTitleShort'), t('header.updateChannel.saveError'))
            } finally {
                setClientChannelLoading(false)
            }
        },
        [allowDevToBetaSwitch, clientChannelState, t],
    )

    const handleModSourceSelect = useCallback(
        async (selectionValue: string) => {
            const selection: ModSourceSelection =
                selectionValue === 'stable' ? { type: 'stable', branch: '' } : { type: 'branch', branch: selectionValue }
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
                console.error('[Home] Failed to switch mod source', error)
                toast.custom('error', t('common.errorTitle'), t('contextMenu.mod.sourceChangeError'))
            } finally {
                setModSourceLoading(false)
            }
        },
        [app, checkModUpdates, modSourceCatalog.selected, setApp, t],
    )

    const branchPickers = useMemo<Partial<Record<BranchComponent, HomeBranchPicker>>>(() => {
        const clientSwitchBlocked = clientUpdateStatus === 'CHECKING' || clientUpdateStatus === 'DOWNLOADING'
        const clientOptions: HomeBranchPicker['options'] = [
            {
                value: 'default',
                label: t('header.updateChannel.optionDefault', { channel: clientChannelState.buildChannel }),
                selected: clientChannelSelection === 'default',
            },
            {
                value: 'beta',
                label: t('header.updateChannel.optionBeta'),
                selected: clientChannelSelection === 'beta',
                disabled: !allowDevToBetaSwitch && clientChannelState.effectiveChannel === 'dev',
            },
            {
                value: 'dev',
                label: t('header.updateChannel.optionDev'),
                selected: clientChannelSelection === 'dev',
            },
        ]

        const modOptions: HomeBranchPicker['options'] = [
            {
                value: 'stable',
                label: t('contextMenu.mod.stable'),
                description: t('contextMenu.mod.stableDescription'),
                selected: modSourceCatalog.selected.type === 'stable',
            },
            ...modSourceCatalog.branches.map(build => ({
                value: build.branch,
                label: build.branch,
                description: `v${build.version} · ${build.commit.slice(0, 7)}`,
                selected: modSourceCatalog.selected.type === 'branch' && modSourceCatalog.selected.branch === build.branch,
            })),
        ]

        if (
            modSourceCatalog.selected.type === 'branch' &&
            !modSourceCatalog.branches.some(build => build.branch === modSourceCatalog.selected.branch)
        ) {
            modOptions.push({
                value: modSourceCatalog.selected.branch,
                label: modSourceCatalog.selected.branch,
                description: t('contextMenu.mod.branchUnavailable'),
                selected: true,
                disabled: true,
            })
        }

        return {
            client: {
                ariaLabel: t('pages.home.selectClientBranch'),
                disabled: clientSwitchBlocked,
                loading: clientChannelLoading,
                options: clientOptions,
                onOpenChange: open => {
                    if (open) void loadClientChannels()
                },
                onSelect: value => void handleClientChannelSelect(value),
            },
            mod: {
                ariaLabel: t('pages.home.selectModBranch'),
                loading: modSourceLoading || !modSourceLoaded,
                options: modOptions,
                onOpenChange: open => {
                    if (open && !modSourceLoaded) void loadModSources()
                },
                onSelect: value => void handleModSourceSelect(value),
            },
        }
    }, [
        allowDevToBetaSwitch,
        clientChannelLoading,
        clientChannelSelection,
        clientChannelState,
        clientUpdateStatus,
        handleClientChannelSelect,
        handleModSourceSelect,
        loadClientChannels,
        loadModSources,
        modSourceCatalog,
        modSourceLoaded,
        modSourceLoading,
        t,
    ])

    const secondaryComponentsWithVersionLabels = useMemo<HomeSecondaryComponent[]>(
        () =>
            secondaryComponents.map(item => {
                if (item.id === 'ffmpeg') {
                    return {
                        ...item,
                        version: subcomponentsMeta?.ffmpeg?.version,
                    }
                }

                if (item.id === 'ytdlp') {
                    return {
                        ...item,
                        version: subcomponentsMeta?.ytdlp?.version,
                    }
                }

                return item
            }),
        [subcomponentsMeta],
    )

    const installObsWidget = useCallback(() => {
        if (widgetInstalled || isObsInstalling) return

        let unsubscribeProgress = () => {}
        let unsubscribeSuccess = () => {}
        let unsubscribeFailure = () => {}

        const cleanupListeners = () => {
            unsubscribeProgress()
            unsubscribeSuccess()
            unsubscribeFailure()
        }

        const handleProgress = ({ progress }: { progress: number }) => {
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

        const handleSuccess = () => {
            cleanupListeners()
            if (widgetDownloadToastIdRef.current) {
                toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'), { id: widgetDownloadToastIdRef.current })
                widgetDownloadToastIdRef.current = null
            } else {
                toast.custom('success', t('common.doneTitle'), t('obsWidget.installSuccess'))
            }
            setWidgetInstalled(true)
            setIsObsInstalling(false)
        }

        const handleFailure = (args: { error?: string }) => {
            cleanupListeners()
            if (widgetDownloadToastIdRef.current) {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: args?.error }), {
                    id: widgetDownloadToastIdRef.current,
                })
                widgetDownloadToastIdRef.current = null
            } else {
                toast.custom('error', t('common.errorTitle'), t('obsWidget.downloadError', { message: args?.error }))
            }
            setIsObsInstalling(false)
        }

        setIsObsInstalling(true)
        unsubscribeProgress = desktopApi.widgets.onDownloadProgress(payload => handleProgress(payload as { progress: number }))
        unsubscribeSuccess = desktopApi.widgets.onDownloadSuccess(handleSuccess)
        unsubscribeFailure = desktopApi.widgets.onDownloadFailure(payload => handleFailure(payload as { error?: string }))
        desktopApi.widgets.downloadObs()
    }, [isObsInstalling, setWidgetInstalled, t, widgetInstalled])

    const openObsWidgetFolder = useCallback(() => {
        if (!widgetInstalled) return

        desktopApi.system.openObsWidgetDirectory()
    }, [widgetInstalled])

    const handleWhatsNewClick = useCallback(
        (componentId: string) => {
            if (componentId === 'music') {
                openYandexMusicChangelogModal()
                return
            }

            if (componentId === 'client') {
                openAppChangelogModal()
                return
            }

            if (componentId === 'mod') {
                openModModal()
            }
        },
        [openAppChangelogModal, openModModal, openYandexMusicChangelogModal],
    )

    const handleCheckUpdatesClick = useCallback(
        (componentId: string) => {
            if (componentId === 'client') {
                desktopApi.updates.check({ manual: true })
                return
            }

            if (componentId === 'mod') {
                void checkModUpdates(app, { manual: true })
            }
        },
        [app, checkModUpdates],
    )

    return (
        <PageLayout title={t('pages.home.title')}>
            <div className={styles.home}>
                <div className={styles.grid}>
                    <HomeNewsSection />
                    <div className={styles.leftColumn}>
                        <HomePrimaryComponentsSection
                            items={primaryComponents}
                            versions={primaryComponentVersions}
                            branches={primaryComponentBranches}
                            branchPickers={branchPickers}
                            isModInstalled={Boolean(app.mod.installed && app.mod.version)}
                            isModUpdateAvailable={Boolean(
                                app.mod.installed && app.mod.version && isModReleaseUpdateAvailable(modInfo[0], app.mod),
                            )}
                            isMusicInstalled={Boolean((isAutonomousMode || musicInstalled) && musicVersion)}
                            onWhatsNewClick={handleWhatsNewClick}
                            onCheckUpdatesClick={handleCheckUpdatesClick}
                        />
                        <HomeSecondaryComponentsSection
                            items={secondaryComponentsWithVersionLabels}
                            isObsInstalled={widgetInstalled}
                            isObsInstalling={isObsInstalling}
                            onInstallObsWidget={installObsWidget}
                            onOpenObsWidgetFolder={openObsWidgetFolder}
                        />
                    </div>
                </div>
            </div>
        </PageLayout>
    )
}
