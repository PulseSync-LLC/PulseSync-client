import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import UserContext from '@entities/user/model/context'
import GetModUpdates from '@entities/mod/api/getModChangelogEntries.query'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import PageLayout from '@widgets/layout/PageLayout'
import toast from '@shared/ui/toast'
import HeaderModals, { ModChangelogEntry } from '@widgets/layout/ui/HeaderModals'

import { primaryComponents, secondaryComponents } from '@pages/home/model/homeDashboard'
import HomeAuxiliaryComponentsSection from '@pages/home/ui/HomeAuxiliaryComponentsSection'
import HomeNewsSection from '@pages/home/ui/HomeNewsSection'
import HomePrimaryComponentsSection from '@pages/home/ui/HomePrimaryComponentsSection'

import * as styles from './home.module.scss'

type GetModUpdatesResponse = {
    getChangelogEntries: ModChangelogEntry[]
}

export default function HomePage() {
    const { app, appInfo, loading, musicInstalled, musicVersion, widgetInstalled, setWidgetInstalled } = useContext(UserContext)
    const { t, i18n } = useTranslation()
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()

    const [isAppModalOpen, setIsAppModalOpen] = useState(false)
    const [isObsInstalling, setIsObsInstalling] = useState(false)
    const isModModalOpen = isModalOpen(Modals.MOD_CHANGELOG)
    const widgetDownloadToastIdRef = useRef<string | null>(null)

    const openAppModal = useCallback(() => setIsAppModalOpen(true), [])
    const closeAppModal = useCallback(() => setIsAppModalOpen(false), [])
    const openModModal = useCallback(() => openModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, openModal])
    const closeModModal = useCallback(() => closeModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, closeModal])

    const formatDate = useCallback(
        (timestamp: number) => {
            const date = new Date(timestamp * 1000)
            return date.toLocaleDateString(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            })
        },
        [i18n.language],
    )

    const shouldFetchModChanges = isModModalOpen && app.mod.installed && !!app.mod.version

    const {
        data: modData,
        loading: loadingModChanges,
        error: modError,
        refetch: refetchModChanges,
    } = useQuery<GetModUpdatesResponse, { modVersion: string }>(GetModUpdates, {
        variables: { modVersion: app.mod.version || '' },
        skip: !shouldFetchModChanges,
        notifyOnNetworkStatusChange: true,
    })

    useEffect(() => {
        if (shouldFetchModChanges) {
            void refetchModChanges()
        }
    }, [app.mod.version, refetchModChanges, shouldFetchModChanges])

    const modChangesInfo = useMemo<ModChangelogEntry[]>(
        () => (Array.isArray(modData?.getChangelogEntries) ? modData.getChangelogEntries : []),
        [modData],
    )

    const primaryComponentVersions = useMemo<Record<string, string>>(
        () => ({
            music: musicInstalled && musicVersion ? musicVersion : t('contextMenu.mod.notInstalled'),
            mod: app.mod.installed && app.mod.version ? app.mod.version : t('contextMenu.mod.notInstalled'),
            client: app.info.version || t('contextMenu.mod.notInstalled'),
        }),
        [app.info.version, app.mod.installed, app.mod.version, musicInstalled, musicVersion, t],
    )

    const installObsWidget = useCallback(() => {
        if (widgetInstalled || isObsInstalling) return

        const handleProgress = (_: unknown, { progress }: { progress: number }) => {
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
            setIsObsInstalling(false)
        }

        const handleFailure = (_: unknown, args: { error?: string }) => {
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
        window.desktopEvents?.on(RendererEvents.DOWNLOAD_OBS_WIDGET_PROGRESS, handleProgress)
        window.desktopEvents?.once(RendererEvents.DOWNLOAD_OBS_WIDGET_SUCCESS, handleSuccess)
        window.desktopEvents?.once(RendererEvents.DOWNLOAD_OBS_WIDGET_FAILURE, handleFailure)
        window.desktopEvents?.send(MainEvents.DOWNLOAD_OBS_WIDGET)
    }, [isObsInstalling, setWidgetInstalled, t, widgetInstalled])

    const handleWhatsNewClick = useCallback(
        (componentId: string) => {
            if (componentId === 'client') {
                openAppModal()
                return
            }

            if (componentId === 'mod') {
                openModModal()
            }
        },
        [openAppModal, openModModal],
    )

    return (
        <PageLayout title={t('pages.home.title')}>
            <HeaderModals
                appError={null}
                appUpdatesInfo={appInfo}
                appVersion={app.info.version}
                closeModModal={closeModModal}
                closeUpdateModal={closeAppModal}
                formatDate={formatDate}
                isModModalOpen={isModModalOpen}
                loadingAppUpdates={loading}
                loadingModChanges={loadingModChanges}
                modal={isAppModalOpen}
                modChangesInfo={modChangesInfo}
                modError={modError}
            />
            <div className={styles.home}>
                <div className={styles.grid}>
                    <div className={styles.leftColumn}>
                        <HomePrimaryComponentsSection
                            items={primaryComponents}
                            versions={primaryComponentVersions}
                            isModInstalled={Boolean(app.mod.installed && app.mod.version)}
                            onWhatsNewClick={handleWhatsNewClick}
                        />
                        <HomeAuxiliaryComponentsSection
                            items={secondaryComponents}
                            isObsInstalled={widgetInstalled}
                            isObsInstalling={isObsInstalling}
                            onInstallObsWidget={installObsWidget}
                        />
                    </div>
                    <HomeNewsSection />
                </div>
            </div>
        </PageLayout>
    )
}
