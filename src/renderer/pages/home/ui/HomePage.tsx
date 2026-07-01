import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import type { SubcomponentsMeta } from '@common/types/subcomponentsMeta'
import UserContext from '@entities/user/model/context'
import PageLayout from '@widgets/layout/PageLayout'
import toast from '@shared/ui/toast'
import { desktopApi } from '@shared/desktop/desktopApi'

import { primaryComponents, secondaryComponents, type HomeSecondaryComponent } from '@pages/home/model/homeDashboard'
import HomeSecondaryComponentsSection from '@pages/home/ui/HomeSecondaryComponentsSection'
import HomeNewsSection from '@pages/home/ui/HomeNewsSection'
import HomePrimaryComponentsSection from '@pages/home/ui/HomePrimaryComponentsSection'

import * as styles from './home.module.scss'

export default function HomePage() {
    const { app, musicInstalled, musicVersion, widgetInstalled, setWidgetInstalled, isAutonomousMode } = useContext(UserContext)
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()

    const [isObsInstalling, setIsObsInstalling] = useState(false)
    const [subcomponentsMeta, setSubcomponentsMeta] = useState<SubcomponentsMeta | undefined>(undefined)
    const widgetDownloadToastIdRef = useRef<string | null>(null)

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

    const primaryComponentVersions = useMemo<Record<string, string>>(
        () => ({
            music: (isAutonomousMode || musicInstalled) && musicVersion ? musicVersion : t('contextMenu.mod.notInstalled'),
            mod: app.mod.installed && app.mod.version ? app.mod.version : t('contextMenu.mod.notInstalled'),
            client: app.info.version || t('contextMenu.mod.notInstalled'),
        }),
        [app.info.version, app.mod.installed, app.mod.version, isAutonomousMode, musicInstalled, musicVersion, t],
    )

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

    return (
        <PageLayout title={t('pages.home.title')}>
            <div className={styles.home}>
                <div className={styles.grid}>
                    <div className={styles.leftColumn}>
                        <HomePrimaryComponentsSection
                            items={primaryComponents}
                            versions={primaryComponentVersions}
                            isModInstalled={Boolean(app.mod.installed && app.mod.version)}
                            isMusicInstalled={Boolean((isAutonomousMode || musicInstalled) && musicVersion)}
                            onWhatsNewClick={handleWhatsNewClick}
                        />
                        <HomeSecondaryComponentsSection
                            items={secondaryComponentsWithVersionLabels}
                            isObsInstalled={widgetInstalled}
                            isObsInstalling={isObsInstalling}
                            onInstallObsWidget={installObsWidget}
                            onOpenObsWidgetFolder={openObsWidgetFolder}
                        />
                    </div>
                    <HomeNewsSection />
                </div>
            </div>
        </PageLayout>
    )
}
