import React, { useCallback, useContext } from 'react'
import { Helmet, HelmetProvider } from '@dr.pogodin/react-helmet'
import Header from '@widgets/layout/header'
import NavButtonPulse from '@shared/ui/PSUI/NavButton'
import Preloader from '@widgets/preloader'
import userContext from '@entities/user/model/context'
import toast from '@shared/ui/toast'
import * as pageStyles from '@widgets/layout/layout.module.scss'
import TooltipButton from '@shared/ui/tooltip_button'
import { useModalContext } from '@app/providers/modal'
import { staticAsset } from '@shared/lib/staticAssets'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useLayoutInstallers } from '@widgets/layout/model/useLayoutInstallers'
import ModUpdateBanner from '@widgets/layout/ui/ModUpdateBanner'
import { useNavigate } from 'react-router-dom'
import { desktopApi } from '@shared/desktop/desktopApi'

interface LayoutProps {
    title: string
    titleDetail?: {
        label: string
        icon?: string
    }
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, titleDetail, children, goBack }) => {
    const { app, setApp, updateAvailable, setUpdate, modInfo, modInfoFetched, musicInstalled, setMusicInstalled, setMusicVersion, isAutonomousMode } =
        useContext(userContext)
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const navigate = useNavigate()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const { isModUpdateAvailable, modInstallError, startUpdate } = useLayoutInstallers({
        app,
        modInfo,
        modInfoFetched,
        musicInstalled,
        openModal,
        setApp,
        setMusicInstalled,
        setMusicVersion,
        setUpdate,
        t,
        modals: {
            LINUX_ASAR_PATH: Modals.LINUX_ASAR_PATH,
            LINUX_PERMISSIONS_MODAL: Modals.LINUX_PERMISSIONS_MODAL,
            MOD_CHANGELOG: Modals.MOD_CHANGELOG,
        },
    })
    const storePageEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientExtensionStoreAccess, false)
    const usersPageEnabled = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientUsersPageAccess, false)
    const openAuthRequiredModal = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault()
            openModal(Modals.BASIC_CONFIRMATION, {
                title: t('layout.authRequired.title'),
                description: t('layout.authRequired.description'),
                confirmLabel: t('header.login'),
                onConfirm: () => navigate('/auth'),
            })
        },
        [Modals.BASIC_CONFIRMATION, navigate, openModal, t],
    )
    const openSettings = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement>) => {
            event.preventDefault()
            openModal(Modals.SETTINGS)
        },
        [Modals.SETTINGS, openModal],
    )

    if (!modInfoFetched) {
        return <Preloader />
    }

    const showDevFrame = app.info.devmark && app.settings.showDevFrame

    return (
        <HelmetProvider>
            <Helmet>
                <title>{`${title}${titleDetail ? ` / ${titleDetail.label}` : ''} - PulseSync`}</title>
            </Helmet>
            <div className={pageStyles.children}>
                <Header goBack={goBack} title={title} titleDetail={titleDetail} />
                <div className={pageStyles.main_window} style={showDevFrame ? { bottom: '20px', borderRadius: '0 0 7px 7px' } : {}}>
                    <div className={pageStyles.navigation_bar}>
                        <div className={pageStyles.navigation_buttons}>
                            <NavButtonPulse to="/home" text={t('layout.nav.home')}>
                                <img src={staticAsset('assets/icons/ui/home.svg')} alt="" aria-hidden="true" />
                            </NavButtonPulse>
                            <NavButtonPulse
                                to="/extensions"
                                text={t('layout.nav.addonsBeta').concat(isAutonomousMode ? `\n${t('layout.nav.unavailableInAutonomous')}` : '')}
                                disabled={!musicInstalled}
                                onClick={isAutonomousMode ? openAuthRequiredModal : undefined}
                            >
                                <img src={staticAsset('assets/icons/ui/extensions.svg')} alt="" aria-hidden="true" />
                            </NavButtonPulse>
                            <NavButtonPulse
                                to="/users"
                                text={t('layout.nav.users').concat(isAutonomousMode ? `\n${t('layout.nav.unavailableInAutonomous')}` : '')}
                                disabled={!musicInstalled || (!isAutonomousMode && !usersPageEnabled)}
                                onClick={isAutonomousMode ? openAuthRequiredModal : undefined}
                            >
                                <img src={staticAsset('assets/icons/ui/users.svg')} alt="" aria-hidden="true" />
                            </NavButtonPulse>
                            <NavButtonPulse
                                to="/store"
                                text={t('layout.nav.extensionsStore').concat(isAutonomousMode ? `\n${t('layout.nav.unavailableInAutonomous')}` : '')}
                                disabled={!musicInstalled || (!isAutonomousMode && !storePageEnabled)}
                                onClick={isAutonomousMode ? openAuthRequiredModal : undefined}
                            >
                                <img src={staticAsset('assets/icons/ui/store.svg')} alt="" aria-hidden="true" />
                            </NavButtonPulse>
                        </div>
                        <div className={clsx(pageStyles.navigation_buttons, pageStyles.alert_fix)}>
                            <NavButtonPulse text={t('settingsModal.title')} onClick={openSettings}>
                                <img src={staticAsset('assets/icons/ui/settings.svg')} alt="" aria-hidden="true" />
                            </NavButtonPulse>
                            {updateAvailable && (
                                <TooltipButton tooltipText={t('layout.installUpdateTooltip')} as={'div'}>
                                    <button
                                        onClick={() => {
                                            setUpdate(false)
                                            desktopApi.updates.install()
                                        }}
                                        className={pageStyles.update_download}
                                    >
                                        <img src={staticAsset('assets/icons/ui/download.svg')} alt="" aria-hidden="true" />
                                    </button>
                                </TooltipButton>
                            )}
                        </div>
                    </div>
                    <ModUpdateBanner
                        app={app}
                        isModUpdateAvailable={isModUpdateAvailable}
                        modInstallError={modInstallError}
                        modInfo={modInfo}
                        onStartUpdate={startUpdate}
                        t={t}
                    />
                    {children}
                </div>
            </div>
        </HelmetProvider>
    )
}

export default Layout
