import React, { CSSProperties, useContext, useEffect, useMemo, useRef, useState } from 'react'

import Minus from './../../../../static/assets/icons/minus.svg'
import Minimize from './../../../../static/assets/icons/minimize.svg'
import Close from './../../../../static/assets/icons/close.svg'
import ArrowDown from './../../../../static/assets/icons/arrowDown.svg'

import userContext from '../../api/context/user.context'
import ContextMenu from '../context_menu'
import Modal from '../PSUI/Modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import * as modalStyles from '../PSUI/Modal/modal.modules.scss'
import * as styles from './header.module.scss'
import * as inputStyle from '../../../../static/styles/page/textInputContainer.module.scss'
import toast from '../toast'
import config, { isDevmark } from '../../api/config'
import getUserToken from '../../api/getUserToken'
import userInitials from '../../api/initials/user.initials'
import { useCharCount } from '../../utils/useCharCount'
import axios from 'axios'
import * as Sentry from '@sentry/electron/renderer'
import { motion } from 'framer-motion'
import TooltipButton from '../tooltip_button'
import { useUserProfileModal } from '../../context/UserProfileModalContext'
import client from '../../api/apolloClient'
import GetModUpdates from '../../api/queries/getModChangelogEntries.query'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '../../api/store/store'
import { closeModal, openModal } from '../../api/store/modalSlice'
import { Track } from '../../api/interfaces/track.interface'
import playerContext from '../../api/context/player.context'
import NavButtonPulse from '../PSUI/NavButton'
import { MdSettings } from 'react-icons/md'
import Loader from '../PSUI/Loader'
interface p {
    goBack?: boolean
}

const Header: React.FC<p> = () => {
    const openSettings = () => {
        window.desktopEvents.send('open-settings-window')
    }

    const avatarInputRef = useRef<HTMLInputElement | null>(null)
    const bannerInputRef = useRef<HTMLInputElement | null>(null)
    const [avatarProgress, setAvatarProgress] = useState(-1)
    const [bannerProgress, setBannerProgress] = useState(-1)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isUserCardOpen, setIsUserCardOpen] = useState(false)
    const { user, appInfo, app, setUser, modInfo } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)
    const [modal, setModal] = useState(false)
    const updateModalRef = useRef<{
        openUpdateModal: () => void
        closeUpdateModal: () => void
    }>(null)
    const modModalRef = useRef<{
        openModal: () => void
        closeModal: () => void
    }>(null)

    const dispatch = useDispatch()
    const isModModalOpen = useSelector((state: RootState) => state.modal.isOpen)
    const containerRef = useRef<HTMLDivElement>(null)
    const userCardRef = useRef<HTMLDivElement>(null)
    const { openUserProfile } = useUserProfileModal()

    const fixedAddon = { charCount: inputStyle.charCount }

    const [playStatus, setPlayStatus] = useState<'playing' | 'pause' | 'null'>('null')

    const openUpdateModal = () => setModal(true)
    const closeUpdateModal = () => setModal(false)

    const openModModal = () => dispatch(openModal())
    const closeModModal = () => dispatch(closeModal())

    modModalRef.current = {
        openModal: openModModal,
        closeModal: closeModModal,
    }
    updateModalRef.current = { openUpdateModal, closeUpdateModal }
    const toggleMenu = () => {
        if (isUserCardOpen) {
            setIsUserCardOpen(false)
        }
        setIsMenuOpen(!isMenuOpen)
    }

    const toggleUserContainer = () => {
        if (isMenuOpen) {
            setIsMenuOpen(false)
        }
        setIsUserCardOpen(!isUserCardOpen)
    }

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node

            if (isMenuOpen && containerRef.current && !containerRef.current.contains(target)) {
                setIsMenuOpen(false)
            }

            if (isUserCardOpen && userCardRef.current && !userCardRef.current.contains(target)) {
                setIsUserCardOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isMenuOpen, isUserCardOpen])

    const statusColors = {
        playing: '#62FF79',
        pause: '#60C2FF',
        null: '#FFD562',
    }
    useEffect(() => {
        const handleDataUpdate = (data: Track) => {
            if (data) {
                if (data.status === 'playing') {
                    setPlayStatus('playing')
                } else if (data.status === 'paused' || data.status === 'idle') {
                    setPlayStatus('pause')
                } else {
                    setPlayStatus('null')
                }
            }
        }
        handleDataUpdate(currentTrack)
    }, [currentTrack])

    useEffect(() => {
        const color = statusColors[playStatus] || statusColors.null
        document.documentElement.style.setProperty('--statusColor', color)
    }, [playStatus])

    useEffect(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents?.invoke('needModalUpdate').then(value => {
                if (value && user.id !== '-1') {
                    openUpdateModal()
                }
            })
            window.desktopEvents?.on('showModModal', () => {
                openModModal()
            })
            return () => {
                window.desktopEvents?.removeAllListeners('showModModal')
                window.desktopEvents?.removeAllListeners('needModalUpdate')
            }
        }
    }, [])

    // const formik = useFormik({
    //     initialValues: {
    //         appId: app.discordRpc.appId,
    //         details: app.discordRpc.details,
    //         state: app.discordRpc.state,
    //         button: app.discordRpc.button,
    //     },
    //     validationSchema: schema,
    //     onSubmit: values => {
    //         const changedValues = getChangedValues(previousValues, values);
    //         if (Object.keys(changedValues).length > 0) {
    //             window.desktopEvents?.send('update-rpcSettings', changedValues);
    //             setPreviousValues(values);
    //             setApp({
    //                 ...app,
    //                 discordRpc: {
    //                     ...app.discordRpc,
    //                     ...values,
    //                 },
    //             });
    //         }
    //     },
    // });
    //
    // const outInputChecker = (e: any) => {
    //     formik.handleBlur(e);
    //     const changedValues = getChangedValues(previousValues, formik.values);
    //     if (formik.isValid && Object.keys(changedValues).length > 0) {
    //         formik.handleSubmit();
    //     }
    // };
    //
    // const getChangedValues = (initialValues: any, currentValues: any) => {
    //     const changedValues: any = {};
    //     for (const key in initialValues) {
    //         if (initialValues[key] !== currentValues[key]) {
    //             changedValues[key] = currentValues[key];
    //         }
    //     }
    //     return changedValues;
    // };

    const logout = () => {
        fetch(config.SERVER_URL + '/auth/logout', {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${getUserToken()}`,
            },
        }).then(async r => {
            const res = await r.json()
            if (res.ok) {
                toast.custom('success', `До встречи ${user.nickname}`, 'Успешный выход')
                window.electron.store.delete('tokens.token')
                setUser(userInitials)
                await client.resetStore()
            }
        })
    }

    const formatDate = (timestamp: any) => {
        const date = new Date(timestamp * 1000)
        return date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })
    }
    function LinkRenderer(props: any) {
        return (
            <a href={props.href} target="_blank" rel="noreferrer">
                {props.children}
            </a>
        )
    }
    useCharCount(containerRef, fixedAddon)

    // if (isNaN(trackStart) || isNaN(trackEnd)) {
    //     return <div>Error: Invalid track timecodes</div>;
    // }

    const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const selectedFile = event.target.files[0]
            setAvatarProgress(-1)
            handleAvatarUpload(selectedFile)
        }
    }

    const handleBannerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const selectedFile = event.target.files[0]
            setBannerProgress(-1)
            handleBannerUpload(selectedFile)
        }
    }

    const handleAvatarUpload = async (file: File) => {
        if (!file) return

        const formData = new FormData()
        formData.append('file', file)

        try {
            const response = await axios.post(`${config.SERVER_URL}/cdn/avatar/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                    Authorization: `Bearer ${window.electron.store.get('tokens.token')}`,
                },
                onUploadProgress: progressEvent => {
                    const { loaded, total } = progressEvent
                    const percentCompleted = Math.floor((loaded * 100) / (total || 1))
                    setAvatarProgress(percentCompleted)
                },
            })

            const data = response.data

            if (data && data.ok) {
                setAvatarProgress(-1)
                setUser((prev: any) => ({
                    ...prev,
                    avatarHash: data.hash,
                    avatarType: data.type,
                }))
                toast.custom('success', 'Готово', 'Аватар успешно загружен!')
            } else {
                setAvatarProgress(-1)
                toast.custom('error', 'Ой...', 'Неизвестная ошибка при загрузке аватара')
            }
        } catch (error) {
            switch (error.response?.data?.message) {
                case 'FILE_TOO_LARGE':
                    toast.custom('error', 'Так-так', 'Размер файла превышает 10мб')
                    break
                case 'FILE_NOT_ALLOWED':
                    toast.custom('error', 'Так-так', 'Файл не является изображением')
                    break
                case 'UPLOAD_FORBIDDEN':
                    toast.custom('error', 'Доступ запрещён', 'Загрузка аватара запрещена')
                    break
                default:
                    toast.custom('error', 'Ой...', 'Ошибка при загрузке аватара, попробуй ещё раз')
                    Sentry.captureException(error)
                    break
            }
            setAvatarProgress(-1)
        }
    }

    const handleBannerUpload = async (file: File) => {
        if (!file) return

        const formData = new FormData()
        formData.append('file', file)

        try {
            const response = await axios.post(`${config.SERVER_URL}/cdn/banner/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                    Authorization: `Bearer ${window.electron.store.get('tokens.token')}`,
                },
                onUploadProgress: progressEvent => {
                    const { loaded, total } = progressEvent
                    const percentCompleted = Math.floor((loaded * 100) / (total || 1))
                    setBannerProgress(percentCompleted)
                },
            })

            const data = response.data

            if (data && data.ok) {
                setBannerProgress(-1)
                setUser((prev: any) => ({
                    ...prev,
                    bannerHash: data.hash,
                    bannerType: data.type,
                }))
                toast.custom('success', 'Готово', 'Баннер успешно загружен!')
            } else {
                setBannerProgress(-1)
                toast.custom('error', 'Ой...', 'Неизвестная ошибка при загрузке баннера')
            }
        } catch (error) {
            if (error.response?.data?.message === 'FILE_TOO_LARGE') {
                toast.custom('error', 'Так-так', 'Размер файла превышает 10мб')
            } else if (error.response?.data?.message === 'UPLOAD_FORBIDDEN') {
                toast.custom('error', 'Доступ запрещён', 'Загрузка баннера запрещена')
            } else {
                toast.custom('error', 'Ой...', 'Ошибка при загрузке баннера, попробуй ещё раз')
                Sentry.captureException(error)
            }
            setBannerProgress(-1)
            console.error('Error uploading banner:', error)
        }
    }

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

    const [modChangesInfoRaw, setModChangesInfoRaw] = useState<any[]>([])
    const [loadingModChanges, setLoadingModChanges] = useState(true)
    const [modError, setModError] = useState<string | null>(null)

    useEffect(() => {
        if (!app.mod.installed || !app.mod.version) return
        setLoadingModChanges(true)
        setModError(null)
        client
            .query({ query: GetModUpdates, variables: { modVersion: app.mod.version } })
            .then(({ data }) => setModChangesInfoRaw(data.getChangelogEntries))
            .catch(err => setModError(err.message))
            .finally(() => setLoadingModChanges(false))
    }, [isModModalOpen, app.mod, modInfo])

    const bannerRef = useRef<HTMLDivElement>(null)
    const [bannerUrl, setBannerUrl] = useState(`${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`)

    useEffect(() => {
        const img = new Image()
        img.src = `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
        img.onload = () => {
            setBannerUrl(`${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`)
        }
        img.onerror = () => {
            setBannerUrl(`${config.S3_URL}/banners/default_banner.webp`)
        }
    }, [user.bannerHash, user.bannerType])

    return (
        <>
            <Modal title="Последние обновления" isOpen={modal} reqClose={closeUpdateModal}>
                <div className={modalStyles.updateModal}>
                    {loadingAppUpdates && <Loader text="Загрузка…" />}
                    {appError && <p>Error: {appError}</p>}
                    {!loadingAppUpdates &&
                        !appError &&
                        appUpdatesInfo
                            .filter(info => info.version <= app.info.version)
                            .map(info => (
                                <div key={info.id} className={modalStyles.updateItem}>
                                    <div className={modalStyles.version_info}>
                                        <h3>{info.version}</h3>
                                        <span>{formatDate(info.createdAt)}</span>
                                    </div>
                                    <div className={modalStyles.remerkStyle}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: LinkRenderer }}>
                                            {info.changelog}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            ))}
                    {!loadingAppUpdates && !appError && appUpdatesInfo.filter(info => info.version <= app.info.version).length === 0 && (
                        <p>Список изменений не найден.</p>
                    )}
                </div>
            </Modal>
            <Modal title="Последние обновления мода" isOpen={isModModalOpen} reqClose={closeModModal}>
                <div className={modalStyles.updateModal}>
                    {loadingModChanges && <Loader text="Загрузка…" />}
                    {modError && <p>Error: {modError}</p>}
                    {!loadingModChanges &&
                        !modError &&
                        modChangesInfoRaw.length > 0 &&
                        modChangesInfoRaw.map(info => (
                            <div key={info.id} className={modalStyles.updateItem}>
                                <div className={modalStyles.version_info}>
                                    <h3>{info.version}</h3>
                                    <span>{formatDate(info.createdAt)}</span>
                                </div>
                                <div className={modalStyles.remerkStyle}>
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkBreaks]}
                                        components={{
                                            a: ({ href, children }) => (
                                                <a href={href} target="_blank" rel="noopener noreferrer">
                                                    {children}
                                                </a>
                                            ),
                                        }}
                                    >
                                        {Array.isArray(info.description) ? info.description.join('\n') : info.description || ''}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        ))}
                    {!loadingModChanges && !modError && modChangesInfoRaw.length === 0 && <p>Список изменений не найден.</p>}
                </div>
            </Modal>
            <header ref={containerRef} className={styles.nav_bar}>
                <div className={styles.fix_size}>
                    {(user.id !== '-1' && (
                        <div className={styles.app_menu}>
                            <button className={styles.settingsButton} onClick={openSettings} disabled>
                                <MdSettings size={22} />
                            </button>
                            <div className={styles.line} />
                            <button
                                className={`${styles.logoplace} ${isMenuOpen ? styles.active : ''}`}
                                onClick={toggleMenu}
                                disabled={user.id === '-1'}
                            >
                                <img className={styles.logoapp} src="static/assets/logo/logoapp.svg" alt="" />
                                <span>PulseSync</span>
                                <div className={isMenuOpen ? styles.true : styles.false}>{user.id != '-1' && <ArrowDown />}</div>
                            </button>
                            {isMenuOpen && <ContextMenu modalRef={updateModalRef} />}
                        </div>
                    )) || <div></div>}
                    <div className={styles.event_container}>
                        {isDevmark && <div className={styles.dev}>DEVELOPMENT BUILD #{window.appInfo.getBranch() ?? 'unknown'}</div>}
                        <div className={styles.menu} ref={userCardRef}>
                            {user.id !== '-1' && (
                                <>
                                    <div className={styles.user_container} onClick={toggleUserContainer}>
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
                                            <img
                                                className={styles.avatar}
                                                src={`${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`}
                                                alt=""
                                                onError={e => {
                                                    ;(e.currentTarget as HTMLImageElement).src = './static/assets/images/undef.png'
                                                }}
                                            />
                                            <div className={styles.status}>
                                                <div className={styles.dot}></div>
                                            </div>
                                        </div>
                                    </div>
                                    {isUserCardOpen && (
                                        <div className={styles.user_menu}>
                                            {/* <div className={styles.user_alert}>
                                                <div
                                                    className={
                                                        styles.alert_info
                                                    }
                                                >
                                                    Предупреждение: Ваш профиль
                                                    скрыт на 7 дней!
                                                </div>
                                                <div
                                                    className={
                                                        styles.alert_reson
                                                    }
                                                >
                                                    Причина: Оскорбительный
                                                    контент в профиле!
                                                </div>
                                            </div> */}
                                            <div className={styles.user_info}>
                                                <div
                                                    className={styles.user_banner}
                                                    ref={bannerRef}
                                                    style={{
                                                        backgroundImage: `linear-gradient(180deg, rgba(31, 34, 43, 0.3) 0%, rgba(31, 34, 43, 0.8) 100%), url(${bannerUrl})`,
                                                    }}
                                                >
                                                    <motion.div
                                                        className={styles.banner_overlay}
                                                        initial={{
                                                            width: '0%',
                                                        }}
                                                        animate={{
                                                            width: bannerProgress !== -1 ? `${bannerProgress}%` : '0%',
                                                        }}
                                                        transition={{
                                                            duration: 0.3,
                                                            ease: 'linear',
                                                        }}
                                                    >
                                                        <div
                                                            className={styles.banner_loader}
                                                            style={
                                                                {
                                                                    '--progress': `${bannerProgress}%`,
                                                                } as CSSProperties
                                                            }
                                                        />
                                                    </motion.div>
                                                    <div className={styles.hoverUpload} onClick={() => bannerInputRef.current!.showPicker()}>
                                                        Загрузить баннер
                                                    </div>
                                                    <div className={styles.badges_container}>
                                                        {user.badges.length > 0 &&
                                                            user.badges
                                                                .sort((a, b) => b.level - a.level)
                                                                .map(_badge => (
                                                                    <TooltipButton tooltipText={_badge.name} side="bottom">
                                                                        <div className={styles.badge} key={_badge.type}>
                                                                            <img src={`static/assets/badges/${_badge.type}.svg`} alt={_badge.type} />
                                                                        </div>
                                                                    </TooltipButton>
                                                                ))}
                                                    </div>
                                                </div>
                                                <div className={styles.user_avatar}>
                                                    <img
                                                        className={styles.avatar}
                                                        src={
                                                            `${user.avatarType}`
                                                                ? `${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`
                                                                : 'static/assets/images/undef.png'
                                                        }
                                                        alt="card_avatar"
                                                        onError={e => {
                                                            ;(e.currentTarget as HTMLImageElement).src = './static/assets/images/undef.png'
                                                        }}
                                                    />
                                                    <motion.div
                                                        className={styles.overlay}
                                                        initial={{ opacity: 0 }}
                                                        transition={{
                                                            duration: 0.3,
                                                            ease: 'linear',
                                                        }}
                                                        animate={{
                                                            opacity: avatarProgress !== -1 ? `${avatarProgress}` : '0',
                                                        }}
                                                    >
                                                        <div
                                                            className={styles.loader}
                                                            style={
                                                                {
                                                                    '--progress': `${avatarProgress}%`,
                                                                } as CSSProperties
                                                            }
                                                        />
                                                    </motion.div>
                                                    <div className={styles.hoverUpload} onClick={() => avatarInputRef.current!.showPicker()}>
                                                        Загрузить аватар
                                                    </div>
                                                    <div className={styles.status}>
                                                        <div className={styles.dot}></div>
                                                    </div>
                                                </div>
                                                <div className={styles.user_details}>
                                                    <div className={styles.user_info}>
                                                        <div
                                                            onClick={() => openUserProfile(user.username)}
                                                            key={user.username}
                                                            className={styles.username}
                                                        >
                                                            {user.nickname}
                                                        </div>
                                                        <div className={styles.usertag}>@{user.username}</div>
                                                        {/*<div className={styles.status_text}>*/}
                                                        {/*    {renderPlayerStatus()}*/}
                                                        {/*    {playStatus === 'playing' && (*/}
                                                        {/*        <>*/}
                                                        {/*            : {currentTrack?.title || 'No Title'} -{' '}*/}
                                                        {/*            {currentTrack.artists.map( x => x.name ).join( ', ' )}*/}
                                                        {/*        </>*/}
                                                        {/*    )}*/}
                                                        {/*</div>*/}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={styles.user_menu_buttons}>
                                                <button onClick={() => openUserProfile(user.username)} key={user.id} className={styles.menu_button}>
                                                    Мой профиль
                                                </button>
                                                <button className={styles.menu_button} disabled>
                                                    Друзья
                                                </button>
                                                <button className={styles.menu_button} disabled>
                                                    Настройки
                                                </button>
                                                <button className={styles.menu_button} onClick={logout}>
                                                    Выйти
                                                </button>
                                            </div>
                                        </div>
                                    )}
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
