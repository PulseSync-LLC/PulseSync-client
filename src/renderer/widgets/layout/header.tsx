import React, { useCallback, useContext, useEffect, useRef, useState } from 'react'
import cn from 'clsx'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import Minus from '@shared/assets/icons/minus.svg'
import Minimize from '@shared/assets/icons/minimize.svg'
import Maximize from '@shared/assets/icons/maximize.svg'
import Close from '@shared/assets/icons/close.svg'
import ArrowDown from '@shared/assets/icons/arrowDown.svg'

import userContext from '@entities/user/model/context'
import ContextMenu from '@features/context_menu'
import * as styles from '@widgets/layout/header.module.scss'
import * as inputStyle from '../../../../static/styles/page/textInputContainer.module.scss'
import rendererHttpClient from '@shared/api/http/client'
import toast from '@shared/ui/toast'
import { isDevmark } from '@common/appConfig'
import userInitials from '@entities/user/model/user.initials'
import { useCharCount } from '@shared/lib/useCharCount'
import { AnimatePresence, motion } from 'framer-motion'
import TooltipButton from '@shared/ui/tooltip_button'
import { useNavigate } from 'react-router-dom'
import client from '@shared/api/apolloClient'
import { staticAsset } from '@shared/lib/staticAssets'
import GetModUpdates from '@entities/mod/api/getModChangelogEntries.query'
import { useModalContext } from '@app/providers/modal'
import playerContext from '@entities/track/model/player.context'
import { MdSettings } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import ExperimentOverridesDevButton from '@widgets/layout/ExperimentOverridesDevButton'
import UpdateChannelOverrideButton from '@widgets/layout/UpdateChannelOverrideButton'
import NotificationsBell from '@widgets/layout/NotificationsBell'
import { Avatar } from '@shared/ui/PSUI/Image'
import { applyPlayStatusColor, getPlayStatus, PlayStatus } from '@widgets/layout/model/playStatus'
import { uploadProfileMedia } from '@widgets/layout/model/profileUploads'
import HeaderModals, { ModChangelogEntry } from '@widgets/layout/ui/HeaderModals'
import UserMenuCard from '@widgets/layout/ui/UserMenuCard'
import type { AppInfoInterface } from '@entities/appInfo/model/appinfo.interface'
import ButtonV2 from '@shared/ui/buttonV2'
import { compareVersions } from '@shared/lib/utils'

interface p {
    goBack?: boolean
}

type GetModUpdatesResponse = {
    getChangelogEntries: ModChangelogEntry[]
}

const Header: React.FC<p> = () => {
    const settingsAvailable = false
    const avatarInputRef = useRef<HTMLInputElement | null>(null)
    const bannerInputRef = useRef<HTMLInputElement | null>(null)
    const [avatarProgress, setAvatarProgress] = useState(-1)
    const [bannerProgress, setBannerProgress] = useState(-1)
    const [isCompactAvatarHovered, setIsCompactAvatarHovered] = useState(false)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isUserCardOpen, setIsUserCardOpen] = useState(false)
    const { user, app, setUser, isAutonomousMode } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)
    const { t } = useTranslation()
    const updateModalRef = useRef<{
        openUpdateModal: () => void
        closeUpdateModal: () => void
    }>(null)

    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()
    const isAppChangelogModalOpen = isModalOpen(Modals.APP_CHANGELOG)
    const isModModalOpen = isModalOpen(Modals.MOD_CHANGELOG)
    const containerRef = useRef<HTMLDivElement>(null)
    const userCardRef = useRef<HTMLDivElement>(null)
    const nav = useNavigate()

    const fixedAddon = { charCount: inputStyle.charCount }

    const [playStatus, setPlayStatus] = useState<PlayStatus>('null')

    const openAppChangelogModal = useCallback(() => openModal(Modals.APP_CHANGELOG), [Modals.APP_CHANGELOG, openModal])
    const closeAppChangelogModal = useCallback(() => closeModal(Modals.APP_CHANGELOG), [Modals.APP_CHANGELOG, closeModal])

    const openModModal = useCallback(() => openModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, openModal])
    const closeModModal = useCallback(() => closeModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, closeModal])

    updateModalRef.current = { openUpdateModal: openAppChangelogModal, closeUpdateModal: closeAppChangelogModal }
    const toggleMenu = useCallback(() => {
        setIsUserCardOpen(false)
        setIsMenuOpen(current => !current)
    }, [])

    const toggleUserContainer = useCallback(() => {
        setIsMenuOpen(false)
        setIsUserCardOpen(current => !current)
    }, [])
    const openLogin = useCallback(() => {
        void nav('/auth')
    }, [nav])

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node

            if (isMenuOpen && containerRef.current && !containerRef.current.contains(target)) {
                setIsMenuOpen(false)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
        }
    }, [isMenuOpen])

    useEffect(() => {
        if (!isUserCardOpen) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (userCardRef.current && !userCardRef.current.contains(target)) {
                setIsUserCardOpen(false)
            }
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsUserCardOpen(false)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isUserCardOpen])

    useEffect(() => {
        setPlayStatus(getPlayStatus(currentTrack))
    }, [currentTrack])

    useEffect(() => {
        applyPlayStatusColor(playStatus)
    }, [playStatus])

    useEffect(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents?.invoke(MainEvents.NEED_MODAL_UPDATE).then(value => {
                if (value) {
                    openAppChangelogModal()
                }
            })
            window.desktopEvents?.on(RendererEvents.SHOW_MOD_MODAL, () => {
                openModModal()
            })
            return () => {
                window.desktopEvents?.removeAllListeners(RendererEvents.SHOW_MOD_MODAL)
                window.desktopEvents?.removeAllListeners(MainEvents.NEED_MODAL_UPDATE)
            }
        }
    }, [openAppChangelogModal, openModModal, user.id])

    const logout = () => {
        rendererHttpClient
            .put<{ ok?: boolean }>('/auth/logout', {
                auth: true,
            })
            .then(async ({ data: res }) => {
                if (res.ok) {
                    toast.custom('success', t('header.logoutTitle', { name: user.nickname }), t('header.logoutMessage'))
                    window.electron.store.delete('tokens.token')
                    setUser(userInitials)
                    await client.clearStore()
                }
            })
    }

    const formatDate = useCallback((timestamp: any) => {
        const date = new Date(timestamp * 1000)
        return date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })
    }, [])

    useCharCount(containerRef, fixedAddon)

    const handleAvatarChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            if (event.target.files) {
                const selectedFile = event.target.files[0]
                setAvatarProgress(-1)
                void uploadProfileMedia({
                    kind: 'avatar',
                    file: selectedFile,
                    setProgress: setAvatarProgress,
                    setUser,
                    t,
                })
            }
        },
        [setUser, t],
    )

    const handleBannerChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            if (event.target.files) {
                const selectedFile = event.target.files[0]
                setBannerProgress(-1)
                void uploadProfileMedia({
                    kind: 'banner',
                    file: selectedFile,
                    setProgress: setBannerProgress,
                    setUser,
                    t,
                })
            }
        },
        [setUser, t],
    )

    const [appUpdatesInfo, setAppUpdatesInfo] = useState<AppInfoInterface[]>([])
    const [loadingAppUpdates, setLoadingAppUpdates] = useState(false)
    const [appError, setAppError] = useState<string | null>(null)
    const [modChangesInfo, setModChangesInfo] = useState<ModChangelogEntry[]>([])
    const [loadingModChanges, setLoadingModChanges] = useState(false)
    const [modError, setModError] = useState<string | null>(null)
    const [isMaximized, setIsMaximized] = useState(false)
    const appUpdatesLoadedRef = useRef(false)
    const appUpdatesLoadingRef = useRef(false)
    const modChangesLoadedKeyRef = useRef<string | null>(null)
    const modChangesLoadingRef = useRef(false)

    useEffect(() => {
        appUpdatesLoadedRef.current = false
        modChangesLoadedKeyRef.current = null
        setAppUpdatesInfo([])
        setModChangesInfo([])
    }, [isAutonomousMode])

    useEffect(() => {
        if (!isAppChangelogModalOpen || appUpdatesLoadedRef.current || appUpdatesLoadingRef.current) {
            return
        }

        let active = true

        const loadAppUpdates = async () => {
            appUpdatesLoadingRef.current = true
            setLoadingAppUpdates(true)
            setAppError(null)

            try {
                const nextAppUpdates = isAutonomousMode ?
                        (((await window.desktopEvents?.invoke(MainEvents.GET_CLIENT_CHANGELOG)) as AppInfoInterface[] | undefined) ?? [])
                    :   await (async () => {
                            const response = await rendererHttpClient.get<{ appInfo?: AppInfoInterface[]; ok?: boolean }>('/api/v1/app/info')
                            const data = response.data

                            if (!response.ok || !data?.ok || !Array.isArray(data.appInfo)) {
                                throw new Error('Failed to fetch app info')
                            }

                            return data.appInfo
                        })()

                if (!active) {
                    return
                }

                const sortedAppInfos = [...nextAppUpdates].sort((a, b) => b.createdAt - a.createdAt)
                setAppUpdatesInfo(sortedAppInfos)
                appUpdatesLoadedRef.current = true
            } catch (error) {
                if (!active) {
                    return
                }

                console.error('Failed to fetch app info:', error)
                setAppError(error instanceof Error ? error.message : 'Failed to fetch app info')
            } finally {
                appUpdatesLoadingRef.current = false
                if (active) {
                    setLoadingAppUpdates(false)
                }
            }
        }

        void loadAppUpdates()

        return () => {
            active = false
        }
    }, [isAppChangelogModalOpen, isAutonomousMode])

    const shouldFetchModChanges = app.mod.installed && !!app.mod.version

    useEffect(() => {
        const modChangesKey = `${isAutonomousMode ? 'autonomous' : 'authorized'}:${app.mod.version || ''}`
        if (!isModModalOpen || !shouldFetchModChanges || modChangesLoadingRef.current || modChangesLoadedKeyRef.current === modChangesKey) {
            return
        }

        let active = true

        const loadModChanges = async () => {
            modChangesLoadingRef.current = true
            setLoadingModChanges(true)
            setModError(null)

            try {
                const nextModChanges = isAutonomousMode ?
                        ((((await window.desktopEvents?.invoke(MainEvents.GET_MOD_CHANGELOG)) as ModChangelogEntry[] | undefined) ?? []).filter(
                            entry => compareVersions(entry.version, app.mod.version || '') <= 0,
                        ))
                    :   await (async () => {
                            const result = await client.query<GetModUpdatesResponse, { modVersion: string }>({
                                query: GetModUpdates,
                                variables: { modVersion: app.mod.version || '' },
                                fetchPolicy: 'no-cache',
                            })

                            return Array.isArray(result.data?.getChangelogEntries) ? result.data.getChangelogEntries : []
                        })()

                if (!active) {
                    return
                }

                setModChangesInfo(nextModChanges)
                modChangesLoadedKeyRef.current = modChangesKey
            } catch (error) {
                if (!active) {
                    return
                }

                console.error('Failed to fetch mod changelog:', error)
                setModError(error instanceof Error ? error.message : 'Failed to fetch mod changelog')
            } finally {
                modChangesLoadingRef.current = false
                if (active) {
                    setLoadingModChanges(false)
                }
            }
        }

        void loadModChanges()

        return () => {
            active = false
        }
    }, [app.mod.version, isAutonomousMode, isModModalOpen, shouldFetchModChanges])

    useEffect(() => {
        window.electron.window.isMaximized().then(value => setIsMaximized(value))

        const unsub1 = window.desktopEvents.on(MainEvents.ELECTRON_WINDOW_MAXIMIZED, () => {
            setIsMaximized(true)
        })
        const unsub2 = window.desktopEvents.on(MainEvents.ELECTRON_WINDOW_UNMAXIMIZED, () => {
            setIsMaximized(false)
        })

        return () => {
            unsub1()
            unsub2()
        }
    }, [])

    return (
        <>
            <HeaderModals
                appError={appError}
                appUpdatesInfo={appUpdatesInfo}
                appVersion={app.info.version}
                closeModModal={closeModModal}
                closeAppChangelogModal={closeAppChangelogModal}
                formatDate={formatDate}
                isAppChangelogModalOpen={isAppChangelogModalOpen}
                isModModalOpen={isModModalOpen}
                loadingAppUpdates={loadingAppUpdates}
                loadingModChanges={loadingModChanges}
                modChangesInfo={modChangesInfo}
                modError={modError}
            />
            <header ref={containerRef} className={styles.nav_bar}>
                <div className={styles.fix_size}>
                    <div className={styles.app_menu}>
                        <TooltipButton tooltipText="В разработке" side="bottom" dataSide={'top'} as="div" className={styles.settingsTooltip}>
                            <button className={styles.settingsButton} disabled={!settingsAvailable}>
                                <MdSettings size={22} />
                            </button>
                        </TooltipButton>
                        <button className={cn(styles.logoplace, isMenuOpen && styles.active)} onClick={toggleMenu}>
                            <img className={styles.logoapp} src={staticAsset('assets/logo/logoapp.svg')} alt="" />
                            <span>PulseSync</span>
                            <div className={isMenuOpen ? styles.true : styles.false}>
                                <ArrowDown />
                            </div>
                        </button>
                        <AnimatePresence>{isMenuOpen && <ContextMenu modalRef={updateModalRef} />}</AnimatePresence>
                    </div>
                    <div className={styles.event_container}>
                        {isDevmark && (
                            <div className={styles.dev}>
                                {t('header.developmentBuild', { branch: window.appInfo.getBranch() ?? t('header.unknownBranch') })}
                            </div>
                        )}
                        <div className={styles.menu} ref={userCardRef}>
                            {!isAutonomousMode ? (
                                <>
                                    <UpdateChannelOverrideButton />
                                    {user.perms === 'developer' && <ExperimentOverridesDevButton />}
                                    <NotificationsBell />
                                    <div
                                        className={styles.user_container}
                                        onClick={toggleUserContainer}
                                        onMouseEnter={() => setIsCompactAvatarHovered(true)}
                                        onMouseLeave={() => setIsCompactAvatarHovered(false)}
                                    >
                                        <input
                                            ref={avatarInputRef}
                                            type={'file'}
                                            accept={'image/*'}
                                            style={{ display: 'none' }}
                                            onChange={handleAvatarChange}
                                        />
                                        <input
                                            ref={bannerInputRef}
                                            type={'file'}
                                            accept={'image/*'}
                                            style={{ display: 'none' }}
                                            onChange={handleBannerChange}
                                        />
                                        <div className={styles.user_avatar}>
                                            <Avatar
                                                className={styles.avatar}
                                                hash={user.avatarHash}
                                                ext={user.avatarType}
                                                sizes="38px"
                                                alt=""
                                                allowAnimate={isCompactAvatarHovered}
                                            />
                                            <div className={styles.status}>
                                                <div className={styles.dot}></div>
                                            </div>
                                        </div>
                                    </div>
                                    <AnimatePresence>
                                        {isUserCardOpen && (
                                            <UserMenuCard
                                                avatarInputRef={avatarInputRef}
                                                avatarProgress={avatarProgress}
                                                bannerInputRef={bannerInputRef}
                                                bannerProgress={bannerProgress}
                                                isOpen={isUserCardOpen}
                                                logout={logout}
                                                onClose={() => setIsUserCardOpen(false)}
                                                t={t}
                                                user={user}
                                            />
                                        )}
                                    </AnimatePresence>
                                </>
                            ) : (
                                <>
                                    <UpdateChannelOverrideButton />
                                    <ButtonV2 className={styles.loginButton} onClick={openLogin}>
                                        {t('header.login')}
                                    </ButtonV2>
                                </>
                            )}
                        </div>
                        <div className={styles.button_container}>
                            <button id="hide" className={styles.button_title} onClick={() => window.electron.window.minimize()}>
                                <Minus />
                            </button>
                            <button id="minimize" className={styles.button_title} onClick={() => window.electron.window.maximize()}>
                                {isMaximized ? <Minimize /> : <Maximize />}
                            </button>
                            <button
                                id="close"
                                className={styles.button_title}
                                onClick={() => window.electron.window.close(app.settings.closeAppInTray)}
                            >
                                <Close />
                            </button>
                        </div>
                    </div>
                </div>
            </header>
        </>
    )
}

export default Header
