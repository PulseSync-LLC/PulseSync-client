import React, { useContext } from 'react'
import { Helmet, HelmetProvider } from '@dr.pogodin/react-helmet'
import MainEvents from '@common/types/mainEvents'
import { MdDownload, MdHandyman, MdPeople, MdPower, MdStoreMallDirectory } from 'react-icons/md'
import Header from '@widgets/layout/header'
import NavButtonPulse from '@shared/ui/PSUI/NavButton'
import Preloader from '@widgets/preloader'
import userContext from '@entities/user/model/context'
import toast from '@shared/ui/toast'
import * as pageStyles from '@widgets/layout/layout.module.scss'
import { isDevmark } from '@common/appConfig'
import TooltipButton from '@shared/ui/tooltip_button'
import { useModalContext } from '@app/providers/modal'
import { staticAsset } from '@shared/lib/staticAssets'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useLayoutInstallers } from '@widgets/layout/model/useLayoutInstallers'
import ModUpdateBanner from '@widgets/layout/ui/ModUpdateBanner'

interface LayoutProps {
    title: string
    children: React.ReactNode
    goBack?: boolean
}

const Layout: React.FC<LayoutProps> = ({ title, children, goBack }) => {
    const { user, app, setApp, updateAvailable, setUpdate, modInfo, modInfoFetched, features, musicInstalled, setMusicInstalled, setMusicVersion } =
        useContext(userContext)
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const { isForceInstallEnabled, isModUpdateAvailable, modUpdateState, startUpdate, updateYandexMusic, isUserDeveloper } = useLayoutInstallers({
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

    if (!modInfoFetched) {
        return <Preloader />
    }

    return (
        <HelmetProvider>
            <Helmet>
                <title>{title + ' - PulseSync'}</title>
            </Helmet>
            <div className={pageStyles.children}>
                <Header goBack={goBack} />
                <div className={pageStyles.main_window} style={isDevmark ? { bottom: '20px' } : {}}>
                    <div className={pageStyles.navigation_bar}>
                        <div className={pageStyles.navigation_buttons}>
                            <NavButtonPulse to="/" end text={t('layout.nav.addonsBeta')} disabled={!musicInstalled}>
                                <MdPower size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/users" text={t('layout.nav.users')} disabled={!features?.usersPage || !musicInstalled}>
                                <MdPeople size={24} />
                            </NavButtonPulse>
                            <NavButtonPulse to="/store" text={t('layout.nav.extensionsStore')} disabled={!storePageEnabled || !musicInstalled}>
                                <MdStoreMallDirectory size={24} />
                            </NavButtonPulse>
                        </div>
                        <div className={clsx(pageStyles.navigation_buttons, pageStyles.alert_fix)}>
                            {isUserDeveloper(user?.perms) && (
                                <NavButtonPulse to="/dev" text={t('layout.nav.development')}>
                                    <MdHandyman size={24} />
                                </NavButtonPulse>
                            )}
                            {updateAvailable && (
                                <TooltipButton tooltipText={t('layout.installUpdateTooltip')} as={'div'}>
                                    <button
                                        onClick={() => {
                                            setUpdate(false)
                                            window.desktopEvents?.send(MainEvents.UPDATE_INSTALL)
                                        }}
                                        className={pageStyles.update_download}
                                    >
                                        <MdDownload size={24} />
                                    </button>
                                </TooltipButton>
                            )}
                        </div>
                    </div>
                    <ModUpdateBanner
                        app={app}
                        isForceInstallEnabled={isForceInstallEnabled}
                        isModUpdateAvailable={isModUpdateAvailable}
                        modInfo={modInfo}
                        modUpdateState={modUpdateState}
                        onStartUpdate={startUpdate}
                        onUpdateMusic={updateYandexMusic}
                        t={t}
                    />
                    {children}
                </div>
            </div>
        </HelmetProvider>
    )
}

export default Layout
