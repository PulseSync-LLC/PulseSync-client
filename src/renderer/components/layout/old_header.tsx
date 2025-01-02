import React, {
    CSSProperties,
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import Minus from './../../../../static/assets/icons/minus.svg'
import Minimize from './../../../../static/assets/icons/minimize.svg'
import Close from './../../../../static/assets/icons/close.svg'
import ArrowDown from './../../../../static/assets/icons/arrowDown.svg'

import userContext from '../../api/context/user.context'
import ContextMenu from '../context_menu'
import Skeleton from 'react-loading-skeleton'
import Modal from '../modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import * as modalStyles from '../modal/modal.modules.scss'
import * as styles from './header.module.scss'
import * as theme from './trackinfo.module.scss'
import * as inputStyle from '../../../../static/styles/page/textInputContainer.module.scss'
import playerContext from '../../../renderer/api/context/player.context'
import { object, string } from 'yup'
import toast from '../../api/toast'
import config from '../../api/config'
import getUserToken from '../../api/getUserToken'
import userInitials from '../../api/initials/user.initials'
import { useCharCount } from '../../utils/useCharCount'
import axios from 'axios'
import UserInterface from '../../api/interfaces/user.interface'
import * as Sentry from '@sentry/electron/renderer'
import { motion } from 'framer-motion'

interface p {
    goBack?: boolean
}

const OldHeader: React.FC<p> = () => {
    const storedStatus = localStorage.getItem('playStatus')
    const avatarInputRef = useRef<HTMLInputElement | null>(null)
    const bannerInputRef = useRef<HTMLInputElement | null>(null)
    const { currentTrack } = useContext(playerContext)
    const [currentTime, setCurrentTime] = useState<number>(0)
    const [avatarProgress, setAvatarProgress] = useState(-1)
    const [bannerProgress, setBannerProgress] = useState(-1)
    const previousStatusRef = useRef<string | null>(null)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isUserCardOpen, setIsUserCardOpen] = useState(false)
    const [isDiscordRpcCardOpen, setIsDiscordRpcCardOpen] = useState(false)
    const [rickRollClick, setRickRoll] = useState(false)
    const { user, appInfo, app, setUser, setApp } = useContext(userContext)
    const [modal, setModal] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const userCardRef = useRef<HTMLDivElement>(null)
    const fixedTheme = { charCount: inputStyle.charCount }
    const [previousValues, setPreviousValues] = useState({
        appId: '',
        details: '',
        state: '',
        button: '',
    })
    const getStoredPlayStatus = () => {
        console.log('Retrieving playStatus from localStorage')
        return storedStatus === 'playing' ||
            storedStatus === 'pause' ||
            storedStatus === 'null'
            ? storedStatus
            : 'null'
    }

    // const normalizeStatus = (status: string | undefined): 'playing' | 'pause' | 'null' => {
    //     console.log('normalizeStatus called with:', status);
    //     if (status === 'play' || status === 'playing') return 'playing';
    //     if (status === 'pause') return 'pause';
    //     return 'null';
    // };
    //
    // const initialPlayStatus = currentTrack
    //     ? normalizeStatus(currentTrack.status)
    //     : getStoredPlayStatus();
    //
    // console.log('Initial playStatus:', initialPlayStatus);
    //
    const [playStatus, setPlayStatus] = useState<'playing' | 'pause' | 'null'>(
        getStoredPlayStatus(),
    )
    //
    // useEffect(() => {
    //     if (currentTrack && typeof currentTrack.status === 'string') {
    //         const normalizedStatus = normalizeStatus(currentTrack.status);
    //         console.log('Updating playStatus based on currentTrack:', normalizedStatus);
    //         if (playStatus !== normalizedStatus) {
    //             setPlayStatus(normalizedStatus);
    //         }
    //     }
    // }, [currentTrack]);
    //
    // useEffect(() => {
    //     console.log('useEffect [playStatus] triggered with playStatus:', playStatus);
    //     let interval: NodeJS.Timeout | undefined;
    //
    //     const fetchTrackInfo = async () => {
    //         const data = await window.desktopEvents.invoke('getTrackInfo');
    //         console.log('Fetched track info:', data);
    //         if (data) {
    //             const normalizedStatus = normalizeStatus(data.status);
    //             console.log('Normalized fetched status:', normalizedStatus);
    //             if (playStatus !== normalizedStatus) {
    //                 console.log('Updating playStatus to:', normalizedStatus);
    //                 setPlayStatus(normalizedStatus);
    //                 previousStatusRef.current = normalizedStatus;
    //             } else {
    //                 console.log('Fetched status matches current playStatus');
    //             }
    //         } else {
    //             console.log('No data received, setting playStatus to null');
    //             setPlayStatus('null');
    //             previousStatusRef.current = 'null';
    //         }
    //     };
    //
    //     if (playStatus === 'null') {
    //         console.log('playStatus is null, starting interval to fetch track info');
    //         interval = setInterval(() => {
    //             fetchTrackInfo();
    //         }, 5000);
    //     } else if (interval) {
    //         console.log('Clearing interval as playStatus is not null');
    //         clearInterval(interval);
    //     }
    //
    //     return () => {
    //         if (interval) {
    //             console.log('Cleaning up interval on unmount');
    //             clearInterval(interval);
    //         }
    //     };
    // }, [playStatus]);
    //
    //
    // useEffect(() => {
    //     console.log('Saving playStatus to localStorage:', playStatus);
    //     localStorage.setItem('playStatus', playStatus);
    // }, [playStatus]);
    //
    // const renderPlayerStatus = () => {
    //     const statusText = playStatus === 'playing'
    //         ? 'Слушает'
    //         : playStatus === 'pause'
    //             ? 'Думает'
    //             : 'Ждёт подключения';
    //     console.log('renderPlayerStatus returns:', statusText);
    //     return statusText;
    // };
    //
    // const trackStart: number = currentTrack?.timestamps
    //     ? Number(currentTrack.timestamps[0] || 0)
    //     : 0;
    // const trackEnd: number = currentTrack?.timestamps
    //     ? Number(currentTrack.timestamps[1] || 0)
    //     : 0;
    //
    // useEffect(() => {
    //     console.log('Playback useEffect triggered');
    //     console.log('Track Start:', trackStart);
    //     console.log('Track End:', trackEnd);
    //
    //     let intervalId: NodeJS.Timeout | null = null;
    //
    //     const startTimestamp = Date.now() - trackStart * 1000;
    //
    //     const updatePlayback = () => {
    //         const elapsedTime = (Date.now() - startTimestamp) / 1000;
    //         const newCurrentTime = Math.min(elapsedTime, trackEnd);
    //         setCurrentTime(newCurrentTime);
    //
    //         console.log('Current Time:', newCurrentTime);
    //
    //         if (newCurrentTime >= trackEnd || playStatus !== 'playing') {
    //             if (intervalId) {
    //                 console.log('Stopping playback interval');
    //                 clearInterval(intervalId);
    //             }
    //         }
    //     };
    //
    //     updatePlayback();
    //     intervalId = setInterval(updatePlayback, 1000);
    //
    //     return () => {
    //         if (intervalId) {
    //             console.log('Cleaning up playback interval');
    //             clearInterval(intervalId);
    //         }
    //     };
    // }, [trackStart, trackEnd, playStatus]);
    //
    //
    // useEffect(() => {
    //     console.log('Current Time:', currentTime.toFixed(2));
    //     console.log('Track Start:', trackStart.toFixed(2));
    //     console.log('Track End:', trackEnd.toFixed(2));
    // }, [currentTime, trackStart, trackEnd]);
    //
    // useEffect(() => {
    //     if (currentTime >= trackStart && currentTime <= trackEnd) {
    //         const progressPercentage = (currentTime / trackEnd) * 100;
    //         setProgress(Math.min(Math.max(progressPercentage, 0), 100));
    //     }
    // }, [currentTime, trackStart, trackEnd]);
    //
    // const formatTime = (timeInSeconds: number): string => {
    //     const minutes = Math.floor(timeInSeconds / 60);
    //     const seconds = Math.floor(timeInSeconds % 60);
    //     return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    //         2,
    //         '0',
    //     )}`;
    // };
    //
    // const schema = object().shape({
    //     appId: string()
    //         .nullable()
    //         .notRequired()
    //         .test(
    //             'len',
    //             'Минимальная длина 18 символов',
    //             val => !val || val.length >= 18,
    //         )
    //         .test(
    //             'len',
    //             'Максимальная длина 20 символов',
    //             val => !val || val.length <= 20,
    //         ),
    //     details: string()
    //         .test(
    //             'len',
    //             'Минимальная длина 2 символа',
    //             val => !val || val.length >= 2,
    //         )
    //         .test(
    //             'len',
    //             'Максимальная длина 128 символов',
    //             val => !val || val.length <= 128,
    //         ),
    //     state: string()
    //         .test(
    //             'len',
    //             'Минимальная длина 2 символа',
    //             val => !val || val.length >= 2,
    //         )
    //         .test(
    //             'len',
    //             'Максимальная длина 128 символов',
    //             val => !val || val.length <= 128,
    //         ),
    //     button: string().test(
    //         'len',
    //         'Максимальная длина 30 символов',
    //         val => !val || val.length <= 30,
    //     ),
    // });
    const openModal = () => setModal(true)
    const closeModal = () => setModal(false)

    const modalRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    modalRef.current = { openModal, closeModal }
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

            if (
                isMenuOpen &&
                containerRef.current &&
                !containerRef.current.contains(target)
            ) {
                setIsMenuOpen(false)
            }

            if (
                isUserCardOpen &&
                userCardRef.current &&
                !userCardRef.current.contains(target)
            ) {
                setIsUserCardOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isMenuOpen, isUserCardOpen])

    const toggleDiscordRpcContainer = () => {
        setIsDiscordRpcCardOpen(!isDiscordRpcCardOpen)
    }

    const statusColors = {
        playing: '#62FF79',
        pause: '#60C2FF',
        null: '#FFD562', // old #FF6289
    }
    // useEffect(() => {
    //     const handleDataUpdate = (data: Track) => {
    //         if (data) {
    //             if (data.status === 'play') {
    //                 setPlayStatus('playing');
    //             } else if (data.status === 'pause') {
    //                 setPlayStatus('pause');
    //             } else {
    //                 setPlayStatus('null');
    //             }
    //         }
    //     };
    //     handleDataUpdate(currentTrack);
    // }, [currentTrack]);
    //
    useEffect(() => {
        const color = statusColors[playStatus] || statusColors.null
        document.documentElement.style.setProperty('--statusColor', color)
    }, [playStatus])

    useEffect(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents?.invoke('needModalUpdate').then((value) => {
                if (value) {
                    openModal()
                }
            })
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
        }).then(async (r) => {
            const res = await r.json()
            if (res.ok) {
                toast.success('Успешный выход')
                window.electron.store.delete('tokens.token')
                setUser(userInitials)
            }
        })
    }

    const memoizedAppInfo = useMemo(() => appInfo, [appInfo])

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
    useCharCount(containerRef, fixedTheme)

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
            const response = await axios.post(
                `${config.SERVER_URL}/cdn/avatar/upload`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                        Authorization: `Bearer ${window.electron.store.get('tokens.token')}`,
                    },
                    onUploadProgress: (progressEvent) => {
                        const { loaded, total } = progressEvent
                        const percentCompleted = Math.floor(
                            (loaded * 100) / (total || 1),
                        )
                        setAvatarProgress(percentCompleted)
                    },
                },
            )

            const data = response.data

            if (data && data.ok) {
                setAvatarProgress(-1)
                setUser((prev: any) => ({
                    ...prev,
                    avatarHash: data.hash,
                    avatarType: data.type,
                }))
                toast.success('Аватар успешно загружен!')
            } else {
                setAvatarProgress(-1)
                toast.error('Неизвестная ошибка при загрузке аватара')
            }
        } catch (error) {
            if (error.response.data.message === 'FILE_TOO_LARGE') {
                toast.error('Размер файла превышает 5мб')
            } else {
                toast.error('Ошибка при загрузке аватара')
                Sentry.captureException(error)
            }
            setAvatarProgress(-1)
            console.error('Error uploading avatar:', error)
        }
    }

    const handleBannerUpload = async (file: File) => {
        if (!file) return

        const formData = new FormData()
        formData.append('file', file)

        try {
            const response = await axios.post(
                `${config.SERVER_URL}/cdn/banner/upload`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                        Authorization: `Bearer ${window.electron.store.get('tokens.token')}`,
                    },
                    onUploadProgress: (progressEvent) => {
                        const { loaded, total } = progressEvent
                        const percentCompleted = Math.floor(
                            (loaded * 100) / (total || 1),
                        )
                        setBannerProgress(percentCompleted)
                    },
                },
            )

            const data = response.data
            console.log('Загрузка баннера ответ сервера:', data)

            if (data && data.ok) {
                setBannerProgress(-1)
                setUser((prev: any) => ({
                    ...prev,
                    bannerHash: data.hash,
                    bannerType: data.type,
                }))
                toast.success('Баннер успешно загружен!')
                console.log('Баннер загружен:', data.hash, data.type)
            } else {
                setBannerProgress(-1)
                toast.error('Неизвестная ошибка при загрузке баннера')
                console.error('Ошибка при загрузке баннера:', data)
            }
        } catch (error) {
            console.log(error)
            if (error.response.data.message === 'FILE_TOO_LARGE') {
                toast.error('Размер файла превышает 5мб')
            } else {
                toast.error('Ошибка при загрузке баннера')
                Sentry.captureException(error)
            }
            setBannerProgress(-1)
            console.error('Error uploading banner:', error)
        }
    }
    return (
        <>
            <Modal title="Последние обновления" isOpen={modal} reqClose={closeModal}>
                <div className={modalStyles.updateModal}>
                    {memoizedAppInfo
                        .filter((info) => info.version <= app.info.version)
                        .map((info) => (
                            <div key={info.id}>
                                <div className={modalStyles.version_info}>
                                    <h3>{info.version}</h3>
                                    <span>{formatDate(info.createdAt)}</span>
                                </div>
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkBreaks]}
                                    components={{ a: LinkRenderer }}
                                >
                                    {info.changelog}
                                </ReactMarkdown>
                                <hr />
                            </div>
                        ))}
                </div>
            </Modal>
            <header ref={containerRef} className={styles.nav_bar}>
                <div className={styles.fix_size}>
                    {(user.id !== '-1' && (
                        <div className={styles.app_menu}>
                            <button
                                className={styles.logoplace}
                                onClick={toggleMenu}
                                disabled={user.id === '-1'}
                            >
                                <img
                                    className={styles.logoapp}
                                    src="static/assets/logo/logoapp.svg"
                                    alt=""
                                />
                                <span>PulseSync</span>
                                <div
                                    className={
                                        isMenuOpen ? styles.true : styles.false
                                    }
                                >
                                    {user.id != '-1' && <ArrowDown />}
                                </div>
                            </button>
                            {isMenuOpen && <ContextMenu modalRef={modalRef} />}
                        </div>
                    )) || <div></div>}
                    <div className={styles.event_container}>
                        <div className={styles.menu} ref={userCardRef}>
                            {user.id !== '-1' && (
                                <>
                                    {/*<div*/}
                                    {/*    className={styles.rpcStatus}*/}
                                    {/*    onClick={toggleDiscordRpcContainer}*/}
                                    {/*>*/}
                                    {/*    <div className={styles.imageDetail}>*/}
                                    {/*        <img*/}
                                    {/*            className={styles.image}*/}
                                    {/*            src={currentTrack?.albumArt || ''}*/}
                                    {/*            alt={currentTrack?.title || 'Track image'}*/}
                                    {/*        />*/}
                                    {/*    </div>*/}
                                    {/*    <div className={styles.rpcDetail}>*/}
                                    {/*        <div className={styles.rpcTitle}>*/}
                                    {/*            {currentTrack?.title || 'No Title'}*/}
                                    {/*        </div>*/}
                                    {/*        <div className={styles.rpcAuthor}>*/}
                                    {/*            {currentTrack.artists.map( x => x.name ).join( ', ' )}*/}
                                    {/*        </div>*/}
                                    {/*    </div>*/}
                                    {/*</div>*/}
                                    {/*{isDiscordRpcCardOpen && (*/}
                                    {/*    <div className={styles.rpcCard}>*/}
                                    {/*        <div className={styles.titleRpc}>*/}
                                    {/*            Настроить статус*/}
                                    {/*        </div>*/}
                                    {/*        <div className={styles.settingsContainer}>*/}
                                    {/*            <div className={styles.options}>*/}
                                    {/*                <CheckboxNav*/}
                                    {/*                    checkType="toggleRpcStatus"*/}
                                    {/*                    description={*/}
                                    {/*                        'Активируйте этот параметр, чтобы ваш текущий ' +*/}
                                    {/*                        'статус отображался в Discord.'*/}
                                    {/*                    }*/}
                                    {/*                >*/}
                                    {/*                    Включить RPC*/}
                                    {/*                </CheckboxNav>*/}
                                    {/*            </div>*/}
                                    {/*            <div className={theme.userRPC}>*/}
                                    {/*                <div className={theme.status}>*/}
                                    {/*                    Слушает PulseSync*/}
                                    {/*                </div>*/}
                                    {/*                <div className={theme.statusRPC}>*/}
                                    {/*                    <div>*/}
                                    {/*                        {app.discordRpc.status &&*/}
                                    {/*                        currentTrack !== trackInitials ? (*/}
                                    {/*                            <div className={theme.flex_container}>*/}
                                    {/*                                <img*/}
                                    {/*                                    className={theme.img}*/}
                                    {/*                                    src={*/}
                                    {/*                                        currentTrack.albumArt ||*/}
                                    {/*                                        './static/assets/logo/logoapp.png'*/}
                                    {/*                                    }*/}
                                    {/*                                    alt=""*/}
                                    {/*                                />*/}
                                    {/*                                <div className={theme.gap}>*/}
                                    {/*                                    <div className={theme.name}>*/}
                                    {/*                                        {app.discordRpc.details.length > 0*/}
                                    {/*                                            ? replaceParams(*/}
                                    {/*                                                app.discordRpc.details,*/}
                                    {/*                                                currentTrack,*/}
                                    {/*                                            )*/}
                                    {/*                                            : `${currentTrack.title} - ${currentTrack.artists.map( x => x.name ).join( ', ' )}`}*/}
                                    {/*                                    </div>*/}
                                    {/*                                    {currentTrack.timestamps.length > 0 && (*/}
                                    {/*                                        <div className={theme.time}>*/}
                                    {/*                                            {app.discordRpc.state.length > 0*/}
                                    {/*                                                ? replaceParams(*/}
                                    {/*                                                    app.discordRpc.state,*/}
                                    {/*                                                    currentTrack,*/}
                                    {/*                                                )*/}
                                    {/*                                                : `${currentTrack.timestamps[0]} - ${*/}
                                    {/*                                                    currentTrack.timestamps[1]*/}
                                    {/*                                                }`}*/}
                                    {/*                                        </div>*/}
                                    {/*                                    )}*/}
                                    {/*                                    <div className={theme.timeline}>*/}
                                    {/*  <span>*/}
                                    {/*    {formatTime(currentTime)}*/}
                                    {/*  </span>*/}
                                    {/*                                        <div className={theme.timeline_line}>*/}
                                    {/*                                            <div*/}
                                    {/*                                                className={*/}
                                    {/*                                                    theme.timeline_progress*/}
                                    {/*                                                }*/}
                                    {/*                                                style={{*/}
                                    {/*                                                    width: `${progress}%`,*/}
                                    {/*                                                }}*/}
                                    {/*                                            ></div>*/}
                                    {/*                                        </div>*/}
                                    {/*                                        <span>*/}
                                    {/*    {formatTime(trackEnd)}*/}
                                    {/*  </span>*/}
                                    {/*                                    </div>*/}
                                    {/*                                </div>*/}
                                    {/*                            </div>*/}
                                    {/*                        ) : (*/}
                                    {/*                            <div className={theme.flex_container}>*/}
                                    {/*                                <Skeleton width={58} height={58} />*/}
                                    {/*                                <div className={theme.gap}>*/}
                                    {/*                                    <Skeleton*/}
                                    {/*                                        width={190}*/}
                                    {/*                                        height={16}*/}
                                    {/*                                    />*/}
                                    {/*                                    <Skeleton*/}
                                    {/*                                        width={80}*/}
                                    {/*                                        height={16}*/}
                                    {/*                                    />*/}
                                    {/*                                    <div className={theme.timeline}>*/}
                                    {/*                                        <Skeleton*/}
                                    {/*                                            width={200}*/}
                                    {/*                                            height={6}*/}
                                    {/*                                        />*/}
                                    {/*                                    </div>*/}
                                    {/*                                </div>*/}
                                    {/*                            </div>*/}
                                    {/*                        )}*/}
                                    {/*                    </div>*/}
                                    {/*                    <div className={theme.buttonRpc}>*/}
                                    {/*                        <div*/}
                                    {/*                            className={theme.button}*/}
                                    {/*                            onClick={() => {*/}
                                    {/*                                setRickRoll(!rickRollClick);*/}
                                    {/*                            }}*/}
                                    {/*                        >*/}
                                    {/*                            {app.discordRpc.button.length > 0*/}
                                    {/*                                ? app.discordRpc.button*/}
                                    {/*                                : '✌️ Open in Yandex Music'}*/}
                                    {/*                        </div>*/}
                                    {/*                        {rickRollClick && (*/}
                                    {/*                            <video*/}
                                    {/*                                width="600"*/}
                                    {/*                                autoPlay*/}
                                    {/*                                loop*/}
                                    {/*                            >*/}
                                    {/*                                <source*/}
                                    {/*                                    src="https://s3.pulsesync.dev/files/heheheha.mp4"*/}
                                    {/*                                    type="video/mp4"*/}
                                    {/*                                />*/}
                                    {/*                            </video>*/}
                                    {/*                        )}*/}
                                    {/*                        <div*/}
                                    {/*                            className={theme.button}*/}
                                    {/*                            onClick={() => {*/}
                                    {/*                                window.open(*/}
                                    {/*                                    'https://github.com/PulseSync-LLC/' +*/}
                                    {/*                                    'YMusic-DRPC/tree/patcher-ts',*/}
                                    {/*                                );*/}
                                    {/*                            }}*/}
                                    {/*                        >*/}
                                    {/*                            ♡ PulseSync Project*/}
                                    {/*                        </div>*/}
                                    {/*                    </div>*/}
                                    {/*                </div>*/}
                                    {/*            </div>*/}
                                    {/*            <div className={styles.options}>*/}
                                    {/*                <div*/}
                                    {/*                    className={*/}
                                    {/*                        inputStyle.textInputContainer*/}
                                    {/*                    }*/}
                                    {/*                >*/}
                                    {/*                    <div>App ID</div>*/}
                                    {/*                    <input*/}
                                    {/*                        type="text"*/}
                                    {/*                        name="appId"*/}
                                    {/*                        aria-errormessage={*/}
                                    {/*                            (formik.errors as any)['appId']*/}
                                    {/*                        }*/}
                                    {/*                        placeholder="984031241357647892"*/}
                                    {/*                        className={inputStyle.styledInput}*/}
                                    {/*                        value={formik.values.appId}*/}
                                    {/*                        onChange={formik.handleChange}*/}
                                    {/*                        onBlur={e => {*/}
                                    {/*                            outInputChecker(e);*/}
                                    {/*                        }}*/}
                                    {/*                    />*/}
                                    {/*                    {formik.touched.appId &&*/}
                                    {/*                    formik.errors.appId ? (*/}
                                    {/*                        <div className={inputStyle.error}>*/}
                                    {/*                            {formik.errors.appId}*/}
                                    {/*                        </div>*/}
                                    {/*                    ) : null}*/}
                                    {/*                </div>*/}
                                    {/*                <div*/}
                                    {/*                    className={*/}
                                    {/*                        inputStyle.textInputContainer*/}
                                    {/*                    }*/}
                                    {/*                >*/}
                                    {/*                    <div>Details</div>*/}
                                    {/*                    <input*/}
                                    {/*                        type="text"*/}
                                    {/*                        name="details"*/}
                                    {/*                        placeholder="enter text"*/}
                                    {/*                        className={inputStyle.styledInput}*/}
                                    {/*                        value={formik.values.details}*/}
                                    {/*                        onChange={formik.handleChange}*/}
                                    {/*                        onBlur={e => {*/}
                                    {/*                            outInputChecker(e);*/}
                                    {/*                        }}*/}
                                    {/*                    />*/}
                                    {/*                    {formik.touched.details &&*/}
                                    {/*                    formik.errors.details ? (*/}
                                    {/*                        <div className={inputStyle.error}>*/}
                                    {/*                            {formik.errors.details}*/}
                                    {/*                        </div>*/}
                                    {/*                    ) : null}*/}
                                    {/*                </div>*/}
                                    {/*                <div*/}
                                    {/*                    className={*/}
                                    {/*                        inputStyle.textInputContainer*/}
                                    {/*                    }*/}
                                    {/*                >*/}
                                    {/*                    <div>State</div>*/}
                                    {/*                    <input*/}
                                    {/*                        type="text"*/}
                                    {/*                        name="state"*/}
                                    {/*                        placeholder="enter text"*/}
                                    {/*                        className={inputStyle.styledInput}*/}
                                    {/*                        value={formik.values.state}*/}
                                    {/*                        onChange={formik.handleChange}*/}
                                    {/*                        onBlur={e => {*/}
                                    {/*                            outInputChecker(e);*/}
                                    {/*                        }}*/}
                                    {/*                    />*/}
                                    {/*                    {formik.touched.state &&*/}
                                    {/*                    formik.errors.state ? (*/}
                                    {/*                        <div className={inputStyle.error}>*/}
                                    {/*                            {formik.errors.state}*/}
                                    {/*                        </div>*/}
                                    {/*                    ) : null}*/}
                                    {/*                </div>*/}
                                    {/*            </div>*/}
                                    {/*            <div className={styles.options}>*/}
                                    {/*                <CheckboxNav*/}
                                    {/*                    checkType="enableRpcButtonListen"*/}
                                    {/*                    description="Активируйте этот параметр, чтобы ваш текущий статус отображался в Discord."*/}
                                    {/*                >*/}
                                    {/*                    Включить кнопку (Слушать)*/}
                                    {/*                </CheckboxNav>*/}
                                    {/*                <div*/}
                                    {/*                    className={*/}
                                    {/*                        inputStyle.textInputContainer*/}
                                    {/*                    }*/}
                                    {/*                >*/}
                                    {/*                    <div>Button</div>*/}
                                    {/*                    <input*/}
                                    {/*                        type="text"*/}
                                    {/*                        name="button"*/}
                                    {/*                        placeholder="enter text"*/}
                                    {/*                        className={inputStyle.styledInput}*/}
                                    {/*                        value={formik.values.button}*/}
                                    {/*                        onChange={formik.handleChange}*/}
                                    {/*                        onBlur={e => {*/}
                                    {/*                            outInputChecker(e);*/}
                                    {/*                        }}*/}
                                    {/*                    />*/}
                                    {/*                    {formik.touched.button &&*/}
                                    {/*                    formik.errors.button ? (*/}
                                    {/*                        <div className={inputStyle.error}>*/}
                                    {/*                            {formik.errors.button}*/}
                                    {/*                        </div>*/}
                                    {/*                    ) : null}*/}
                                    {/*                </div>*/}
                                    {/*                <CheckboxNav*/}
                                    {/*                    disabled={*/}
                                    {/*                        !user.badges.some(*/}
                                    {/*                            badge =>*/}
                                    {/*                                badge.type === 'supporter',*/}
                                    {/*                        )*/}
                                    {/*                    }*/}
                                    {/*                    checkType="enableGithubButton"*/}
                                    {/*                    description="Активируйте этот параметр, чтобы показать что вы любите разработчиков."*/}
                                    {/*                >*/}
                                    {/*                    Включить кнопку (PulseSync Project)*/}
                                    {/*                </CheckboxNav>*/}
                                    {/*            </div>*/}
                                    {/*        </div>*/}
                                    {/*    </div>*/}
                                    {/*)}*/}
                                    <div
                                        className={styles.user_container}
                                        onClick={toggleUserContainer}
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
                                            <img
                                                className={styles.avatar}
                                                src={`${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`}
                                                alt=""
                                                onError={(e) => {
                                                    ;(
                                                        e.currentTarget as HTMLImageElement
                                                    ).src =
                                                        './static/assets/images/undef.png'
                                                }}
                                            />
                                            <div className={styles.status}>
                                                <div className={styles.dot}></div>
                                            </div>
                                        </div>
                                        <div className={styles.user_info}>
                                            <div className={styles.username}>
                                                {user.username}
                                            </div>
                                            {/*<div className={styles.status_text}>*/}
                                            {/*    {renderPlayerStatus()}*/}
                                            {/*</div>*/}
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
                                                    style={{
                                                        backgroundImage:
                                                            `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
                                                                ? `linear-gradient(180deg, rgba(31, 34, 43, 0.3) 0%, rgba(31, 34, 43, 0.8) 100%), url(${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType})`
                                                                : 'linear-gradient(180deg, rgba(31, 34, 43, 0.3) 0%, rgba(31, 34, 43, 0.8) 100%), url(https://i.pinimg.com/originals/36/5e/66/365e667dfc1b90180dc16b595e8f1c88.gif)',
                                                    }}
                                                >
                                                    <motion.div
                                                        className={
                                                            styles.banner_overlay
                                                        }
                                                        initial={{ width: '0%' }}
                                                        animate={{
                                                            width:
                                                                bannerProgress !== -1
                                                                    ? `${bannerProgress}%`
                                                                    : '0%',
                                                        }}
                                                        transition={{
                                                            duration: 0.3,
                                                            ease: 'linear',
                                                        }}
                                                    >
                                                        <div
                                                            className={
                                                                styles.banner_loader
                                                            }
                                                            style={
                                                                {
                                                                    '--progress': `${bannerProgress}%`,
                                                                } as CSSProperties
                                                            }
                                                        />
                                                    </motion.div>
                                                    <div
                                                        className={
                                                            styles.hoverUpload
                                                        }
                                                        onClick={() =>
                                                            bannerInputRef.current!.showPicker()
                                                        }
                                                    >
                                                        Загрузить баннер
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.badges_container
                                                        }
                                                    >
                                                        {user.badges.length > 0 &&
                                                            user.badges
                                                                .sort(
                                                                    (a, b) =>
                                                                        b.level -
                                                                        a.level,
                                                                )
                                                                .map((_badge) => (
                                                                    <div
                                                                        className={
                                                                            styles.badge
                                                                        }
                                                                        key={
                                                                            _badge.type
                                                                        }
                                                                    >
                                                                        <img
                                                                            src={`static/assets/badges/${_badge.type}.svg`}
                                                                            alt={
                                                                                _badge.type
                                                                            }
                                                                        />
                                                                        <span
                                                                            className={
                                                                                styles.tooltip
                                                                            }
                                                                        >
                                                                            {
                                                                                _badge.name
                                                                            }
                                                                        </span>
                                                                    </div>
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
                                                    />
                                                    <motion.div
                                                        className={styles.overlay}
                                                        initial={{ opacity: 0 }}
                                                        transition={{
                                                            duration: 0.3,
                                                            ease: 'linear',
                                                        }}
                                                        animate={{
                                                            opacity:
                                                                avatarProgress !== -1
                                                                    ? `${avatarProgress}`
                                                                    : '0',
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
                                                    <div
                                                        className={
                                                            styles.hoverUpload
                                                        }
                                                        onClick={() =>
                                                            avatarInputRef.current!.showPicker()
                                                        }
                                                    >
                                                        Загрузить аватар
                                                    </div>
                                                    <div className={styles.status}>
                                                        <div
                                                            className={styles.dot}
                                                        ></div>
                                                    </div>
                                                </div>
                                                <div className={styles.user_details}>
                                                    <div
                                                        className={styles.user_info}
                                                    >
                                                        <div
                                                            className={
                                                                styles.username
                                                            }
                                                        >
                                                            {user.username}
                                                        </div>
                                                        <div
                                                            className={
                                                                styles.usertag
                                                            }
                                                        >
                                                            @{user.username}
                                                        </div>
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
                                            <div
                                                className={styles.user_menu_buttons}
                                            >
                                                <button
                                                    className={styles.menu_button}
                                                    disabled
                                                >
                                                    Друзья
                                                </button>
                                                <button
                                                    className={styles.menu_button}
                                                    disabled
                                                >
                                                    Настройки
                                                </button>
                                                <button
                                                    className={styles.menu_button}
                                                    onClick={logout}
                                                >
                                                    Выйти
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <div className={styles.button_container}>
                            <button
                                id="hide"
                                className={styles.button_title}
                                onClick={() => window.electron.window.minimize()}
                            >
                                <Minus color="#E4E5EA" />
                            </button>
                            <button
                                id="minimize"
                                className={styles.button_title}
                                onClick={() => window.electron.window.maximize()}
                            >
                                <Minimize color="#E4E5EA" />
                            </button>
                            <button
                                id="close"
                                className={styles.button_title}
                                onClick={() =>
                                    window.electron.window.close(
                                        app.settings.closeAppInTray,
                                    )
                                }
                            >
                                <Close color="#E4E5EA" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>
        </>
    )
}

export default OldHeader
