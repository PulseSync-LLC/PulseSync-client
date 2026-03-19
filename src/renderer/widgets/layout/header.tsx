import React, { CSSProperties, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import cn from 'clsx'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

import Minus from '@shared/assets/icons/minus.svg'
import Minimize from '@shared/assets/icons/minimize.svg'
import Close from '@shared/assets/icons/close.svg'
import ArrowDown from '@shared/assets/icons/arrowDown.svg'

import userContext from '@entities/user/model/context'
import ContextMenu from '@features/context_menu'
import * as styles from '@widgets/layout/header.module.scss'
import * as inputStyle from '../../../../static/styles/page/textInputContainer.module.scss'
import toast from '@shared/ui/toast'
import config, { isDev, isDevmark } from '@common/appConfig'
import getUserToken from '@shared/lib/auth/getUserToken'
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
import { useQuery } from '@apollo/client/react'
import { useTranslation } from 'react-i18next'
import ExperimentOverridesDevButton from '@widgets/layout/ExperimentOverridesDevButton'
import NotificationsBell from '@widgets/layout/NotificationsBell'
import { Avatar, Banner } from '@shared/ui/PSUI/Image'
import { applyPlayStatusColor, getPlayStatus, PlayStatus } from '@widgets/layout/model/playStatus'
import { uploadProfileMedia } from '@widgets/layout/model/profileUploads'
import HeaderModals, { ModChangelogEntry } from '@widgets/layout/ui/HeaderModals'
import UserMenuCard from '@widgets/layout/ui/UserMenuCard'

interface p {
    goBack?: boolean
}

type GetModUpdatesResponse = {
    getChangelogEntries: ModChangelogEntry[]
}

const Header: React.FC<p> = () => {
    const openSettings = useCallback(() => {
        window.desktopEvents.send(MainEvents.OPEN_SETTINGS_WINDOW)
    }, [])
    const settingsAvailable = false
    const avatarInputRef = useRef<HTMLInputElement | null>(null)
    const bannerInputRef = useRef<HTMLInputElement | null>(null)
    const [avatarProgress, setAvatarProgress] = useState(-1)
    const [bannerProgress, setBannerProgress] = useState(-1)
    const [isCompactAvatarHovered, setIsCompactAvatarHovered] = useState(false)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isUserCardOpen, setIsUserCardOpen] = useState(false)
    const { user, appInfo, app, setUser } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)
    const { t } = useTranslation()
    const [modal, setModal] = useState(false)
    const updateModalRef = useRef<{
        openUpdateModal: () => void
        closeUpdateModal: () => void
    }>(null)

    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()
    const isModModalOpen = isModalOpen(Modals.MOD_CHANGELOG)
    const containerRef = useRef<HTMLDivElement>(null)
    const userCardRef = useRef<HTMLDivElement>(null)
    const nav = useNavigate()

    const fixedAddon = { charCount: inputStyle.charCount }

    const [playStatus, setPlayStatus] = useState<PlayStatus>('null')

    const openUpdateModal = useCallback(() => setModal(true), [])
    const closeUpdateModal = useCallback(() => setModal(false), [])

    const openModModal = useCallback(() => openModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, openModal])
    const closeModModal = useCallback(() => closeModal(Modals.MOD_CHANGELOG), [Modals.MOD_CHANGELOG, closeModal])

    updateModalRef.current = { openUpdateModal, closeUpdateModal }
    const toggleMenu = useCallback(() => {
        setIsUserCardOpen(false)
        setIsMenuOpen(current => !current)
    }, [])

    const toggleUserContainer = useCallback(() => {
        setIsMenuOpen(false)
        setIsUserCardOpen(current => !current)
    }, [])

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
                if (value && user.id !== '-1') {
                    openUpdateModal()
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
    }, [])

    const logout = () => {
        fetch(config.SERVER_URL + '/auth/logout', {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${getUserToken()}`,
            },
        }).then(async r => {
            const res = await r.json()
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

    const memoizedAppInfo = useMemo(() => appInfo, [appInfo])

    const [appUpdatesInfo, setAppUpdatesInfo] = useState<typeof appInfo>([])
    const [loadingAppUpdates, setLoadingAppUpdates] = useState(true)
    const [appError, setAppError] = useState<string | null>(null)

    useEffect(() => {
        setLoadingAppUpdates(true)
        setAppError(null)

        Promise.resolve(memoizedAppInfo)
            .then(data => {
                setAppUpdatesInfo(data || [])
            })
            .catch(e => {
                setAppError(e.message)
            })
            .finally(() => {
                setLoadingAppUpdates(false)
            })
    }, [memoizedAppInfo])

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
            refetchModChanges()
        }
    }, [shouldFetchModChanges, app.mod.version, refetchModChanges])

    const modChangesInfoRaw: ModChangelogEntry[] = Array.isArray(modData?.getChangelogEntries) ? modData!.getChangelogEntries : []

    return (
        <>
            <HeaderModals
                appError={appError}
                appUpdatesInfo={appUpdatesInfo}
                appVersion={app.info.version}
                closeModModal={closeModModal}
                closeUpdateModal={closeUpdateModal}
                formatDate={formatDate}
                isModModalOpen={isModModalOpen}
                loadingAppUpdates={loadingAppUpdates}
                loadingModChanges={loadingModChanges}
                modal={modal}
                modChangesInfo={modChangesInfoRaw}
                modError={modError}
            />
            <header ref={containerRef} className={styles.nav_bar}>
                <div className={styles.fix_size}>
                    {(user.id !== '-1' && (
                        <div className={styles.app_menu}>
                            {!settingsAvailable ? (
                                <TooltipButton tooltipText="В разработке" side="bottom" as="div" className={styles.settingsTooltip}>
                                    <button className={styles.settingsButton} onClick={openSettings} disabled={!settingsAvailable}>
                                        <MdSettings size={22} />
                                    </button>
                                </TooltipButton>
                            ) : (
                                <button className={styles.settingsButton} onClick={openSettings} disabled={!settingsAvailable}>
                                    <MdSettings size={22} />
                                </button>
                            )}
                            <div className={styles.line} />
                            <button className={cn(styles.logoplace, isMenuOpen && styles.active)} onClick={toggleMenu} disabled={user.id === '-1'}>
                                <img className={styles.logoapp} src={staticAsset('assets/logo/logoapp.svg')} alt="" />
                                <span>PulseSync</span>
                                <div className={isMenuOpen ? styles.true : styles.false}>{user.id != '-1' && <ArrowDown />}</div>
                            </button>
                            {isMenuOpen && <ContextMenu modalRef={updateModalRef} />}
                        </div>
                    )) || <div></div>}
                    <div className={styles.event_container}>
                        {isDevmark && (
                            <div className={styles.dev}>
                                {t('header.developmentBuild', { branch: window.appInfo.getBranch() ?? t('header.unknownBranch') })}
                            </div>
                        )}
                        <div className={styles.menu} ref={userCardRef}>
                            {user.id !== '-1' && (
                                <>
                                    {(user.perms === 'developer' || isDev) && <ExperimentOverridesDevButton />}
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
                            )}
                        </div>
                        <div className={styles.button_container}>
                            <button id="hide" className={styles.button_title} onClick={() => window.electron.window.minimize()}>
                                <Minus />
                            </button>
                            <button id="minimize" className={styles.button_title} onClick={() => window.electron.window.maximize()}>
                                <Minimize />
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
