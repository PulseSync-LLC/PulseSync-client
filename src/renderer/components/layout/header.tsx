import React, {
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
import TrackInterface from '../../api/interfaces/track.interface'
import { object, string } from 'yup'
import toast from '../../api/toast'
import config from '../../api/config'
import getUserToken from '../../api/getUserToken'
import userInitials from '../../api/initials/user.initials'
import trackInitials from '../../api/initials/track.initials'
import CheckboxNav from '../../components/checkbox'
import { replaceParams } from '../../utils/formatRpc'
import { useCharCount } from '../../utils/useCharCount'
import { useFormik } from 'formik'

interface p {
    goBack?: boolean
}

const Header: React.FC<p> = ({ goBack }) => {
    const storedStatus = localStorage.getItem('playStatus')
    const { currentTrack } = useContext(playerContext)
    const [currentTime, setCurrentTime] = useState<number>(0)
    const [progress, setProgress] = useState<number>(0)

    const getStoredPlayStatus = () => {
        return storedStatus === 'play' || storedStatus === 'pause' || storedStatus === 'null'
            ? storedStatus
            : 'null'
    }

    const [playStatus, setPlayStatus] = useState<'play' | 'pause' | 'null'>(
        currentTrack?.status === 'play' ||
            currentTrack?.status === 'pause' ||
            currentTrack?.status === 'null'
            ? currentTrack.status
            : getStoredPlayStatus(),
    )
    const [socket, setSocket] = useState<WebSocket | null>(null)

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:2007')

        ws.onopen = () => {
            console.log('WebSocket connection established')
            setSocket(ws)
        }

        ws.onmessage = event => {
            const message = JSON.parse(event.data)
            if (message.type === 'trackInfo' && message.data) {
                const trackInfo = message.data
                if (
                    trackInfo.status === 'play' ||
                    trackInfo.status === 'pause'
                ) {
                    setPlayStatus(trackInfo.status)
                } else {
                    setPlayStatus('null')
                }
            }
        }

        ws.onerror = error => {
            console.error('WebSocket error:', error)
        }

        ws.onclose = () => {
            console.log('WebSocket connection closed')
            setSocket(null)
        }

        return () => {
            ws.close()
        }
    }, [])

    useEffect(() => {
        const interval = setInterval(() => {
            if (socket && playStatus === 'null') {
                socket.send(JSON.stringify({ type: 'getTrackInfo' }))
            }
        }, 5000)

        return () => {
            clearInterval(interval)
        }
    }, [socket, playStatus])

    useEffect(() => {
        localStorage.setItem('playStatus', playStatus)
    }, [playStatus])

    const renderPlayerStatus = () => {
        if (playStatus === 'play') {
            return 'Слушает'
        } else if (playStatus === 'pause') {
            return 'Думает'
        } else {
            return 'Ждёт подключения'
        }
    }

    if (!currentTrack || !currentTrack.timecodes) {
        return <div>Loading...</div>
    }

    const trackStart: number = Number(currentTrack.timecodes[0] || 0)
    const trackEnd: number = Number(currentTrack.timecodes[1] || 0)

    if (isNaN(trackStart) || isNaN(trackEnd)) {
        return <div>Error: Invalid track timecodes</div>
    }

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null

        const startTimestamp = Date.now() - trackStart * 1000

        const updatePlayback = () => {
            const elapsedTime = (Date.now() - startTimestamp) / 1000
            const newCurrentTime = Math.min(elapsedTime, trackEnd)
            setCurrentTime(newCurrentTime)

            if (newCurrentTime >= trackEnd || playStatus != 'play') {
                clearInterval(intervalId)
            }
        }

        updatePlayback()
        intervalId = setInterval(updatePlayback, 1000)

        return () => {
            if (intervalId) clearInterval(intervalId)
        }
    }, [trackStart, trackEnd, playStatus])

    useEffect(() => {
        console.log('Current Time:', currentTime.toFixed(2))
        console.log('Track Start:', trackStart.toFixed(2))
        console.log('Track End:', trackEnd.toFixed(2))
    }, [currentTime, trackStart, trackEnd])

    useEffect(() => {
        if (currentTime >= trackStart && currentTime <= trackEnd) {
            const progressPercentage = (currentTime / trackEnd) * 100
            setProgress(Math.min(Math.max(progressPercentage, 0), 100))
        }
    }, [currentTime, trackStart, trackEnd])

    const formatTime = (timeInSeconds: number): string => {
        const minutes = Math.floor(timeInSeconds / 60)
        const seconds = Math.floor(timeInSeconds % 60)
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }

    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isUserCardOpen, setIsUserCardOpen] = useState(false)
    const [isDiscordRpcCardOpen, setIsDiscordRpcCardOpen] = useState(false)
    const [rickRollClick, setRickRoll] = useState(false)
    const { user, appInfo, app, setUser, setApp } = useContext(userContext)
    const [modal, setModal] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const fixedTheme = { charCount: inputStyle.charCount }
    const [previousValues, setPreviousValues] = useState({
        appId: '',
        details: '',
        state: '',
        button: '',
    })
    const schema = object().shape({
        appId: string()
            .nullable()
            .notRequired()
            .test(
                'len',
                'Минимальная длина 18 символов',
                val => !val || val.length >= 18,
            )
            .test(
                'len',
                'Максимальная длина 20 символов',
                val => !val || val.length <= 20,
            ),
        details: string()
            .test(
                'len',
                'Минимальная длина 2 символа',
                val => !val || val.length >= 2,
            )
            .test(
                'len',
                'Максимальная длина 128 символов',
                val => !val || val.length <= 128,
            ),
        state: string()
            .test(
                'len',
                'Минимальная длина 2 символа',
                val => !val || val.length >= 2,
            )
            .test(
                'len',
                'Максимальная длина 128 символов',
                val => !val || val.length <= 128,
            ),
        button: string().test(
            'len',
            'Максимальная длина 30 символов',
            val => !val || val.length <= 30,
        ),
    })
    const openModal = () => setModal(true)
    const closeModal = () => setModal(false)

    const modalRef = useRef<{ openModal: () => void; closeModal: () => void }>(
        null,
    )

    modalRef.current = { openModal, closeModal }
    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen)
    }

    const toggleUserContainer = () => {
        setIsUserCardOpen(!isUserCardOpen)
    }

    const toggleDiscordRpcContainer = () => {
        setIsDiscordRpcCardOpen(!isDiscordRpcCardOpen)
    }

    const statusColors = {
        play: '#62FF79',
        pause: '#60C2FF',
        null: '#FF6289',
    }

    useEffect(() => {
        const handleDataUpdate = (data: TrackInterface) => {
            if (data) {
                if (data.status === 'playing') {
                    setPlayStatus('play')
                } else if (data.status === 'paused') {
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
                if (value) {
                    openModal()
                }
            })
        }
    }, [])

    const formik = useFormik({
        initialValues: {
            appId: app.discordRpc.appId,
            details: app.discordRpc.details,
            state: app.discordRpc.state,
            button: app.discordRpc.button,
        },
        validationSchema: schema,
        onSubmit: values => {
            const changedValues = getChangedValues(previousValues, values)
            if (Object.keys(changedValues).length > 0) {
                window.desktopEvents?.send('update-rpcSettings', changedValues)
                setPreviousValues(values)
                setApp({
                    ...app,
                    discordRpc: {
                        ...app.discordRpc,
                        ...values,
                    },
                })
            }
        },
    })

    const outInputChecker = (e: any) => {
        formik.handleBlur(e)
        const changedValues = getChangedValues(previousValues, formik.values)
        if (formik.isValid && Object.keys(changedValues).length > 0) {
            formik.handleSubmit()
        }
    }

    const getChangedValues = (initialValues: any, currentValues: any) => {
        const changedValues: any = {}
        for (const key in initialValues) {
            if (initialValues[key] !== currentValues[key]) {
                changedValues[key] = currentValues[key]
            }
        }
        return changedValues
    }

    const logout = () => {
        fetch(config.SERVER_URL + '/auth/logout', {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${getUserToken()}`,
            },
        }).then(async r => {
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

    return (
        <>
            <Modal
                title="Последние обновления"
                isOpen={modal}
                reqClose={closeModal}
            >
                <div className={modalStyles.updateModal}>
                    {memoizedAppInfo
                        .filter(info => info.version <= app.info.version)
                        .map(info => (
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
                            {isMenuOpen && <ContextMenu modalRef={modalRef} />}
                        </button>
                    </div>
                    <div className={styles.event_container}>
                        <div className={styles.menu}>
                            {user.id !== '-1' && (
                                <>
                                    <div
                                        className={styles.rpcStatus}
                                        onClick={toggleDiscordRpcContainer}
                                    >
                                        <div className={styles.imageDetail}>
                                            <img
                                                className={styles.image}
                                                src={
                                                    currentTrack
                                                        ?.requestImgTrack?.[0] ||
                                                    ''
                                                }
                                                alt={
                                                    currentTrack?.playerBarTitle ||
                                                    'Track image'
                                                }
                                            />
                                        </div>
                                        <div className={styles.rpcDetail}>
                                            <div className={styles.rpcTitle}>
                                                {currentTrack?.playerBarTitle ||
                                                    'No Title'}
                                            </div>
                                            <div className={styles.rpcAuthor}>
                                                {currentTrack?.artist ||
                                                    'Unknown Artist'}
                                            </div>
                                        </div>
                                    </div>
                                    {isDiscordRpcCardOpen && (
                                        <div className={styles.rpcCard}>
                                            <div className={styles.titleRpc}>
                                                Настроить статус
                                            </div>
                                            <div
                                                className={
                                                    styles.settingsContainer
                                                }
                                            >
                                                <div className={styles.options}>
                                                    <CheckboxNav
                                                        checkType="toggleRpcStatus"
                                                        description={
                                                            'Активируйте этот параметр, чтобы ваш текущий статус отображался в Discord.'
                                                        }
                                                    >
                                                        Включить RPC
                                                    </CheckboxNav>
                                                </div>
                                                <div className={theme.userRPC}>
                                                    <div
                                                        className={theme.status}
                                                    >
                                                        Слушает PulseSync
                                                    </div>
                                                    <div
                                                        className={
                                                            theme.statusRPC
                                                        }
                                                    >
                                                        <div>
                                                            {app.discordRpc
                                                                .status &&
                                                            currentTrack !==
                                                                trackInitials ? (
                                                                <div
                                                                    className={
                                                                        theme.flex_container
                                                                    }
                                                                >
                                                                    <img
                                                                        className={
                                                                            theme.img
                                                                        }
                                                                        src={
                                                                            currentTrack
                                                                                .requestImgTrack[0]
                                                                                ? currentTrack
                                                                                      .requestImgTrack[0]
                                                                                : './static/assets/logo/logoapp.png'
                                                                        }
                                                                        alt=""
                                                                    />
                                                                    <div
                                                                        className={
                                                                            theme.gap
                                                                        }
                                                                    >
                                                                        <div
                                                                            className={
                                                                                theme.name
                                                                            }
                                                                        >
                                                                            {app
                                                                                .discordRpc
                                                                                .details
                                                                                .length >
                                                                            0
                                                                                ? replaceParams(
                                                                                      app
                                                                                          .discordRpc
                                                                                          .details,
                                                                                      currentTrack,
                                                                                  )
                                                                                : `${currentTrack.playerBarTitle} - ${currentTrack.artist}`}
                                                                        </div>
                                                                        {currentTrack
                                                                            .timecodes
                                                                            .length >
                                                                            0 && (
                                                                            <div
                                                                                className={
                                                                                    theme.time
                                                                                }
                                                                            >
                                                                                {app
                                                                                    .discordRpc
                                                                                    .state
                                                                                    .length >
                                                                                0
                                                                                    ? replaceParams(
                                                                                          app
                                                                                              .discordRpc
                                                                                              .state,
                                                                                          currentTrack,
                                                                                      )
                                                                                    : `${currentTrack.timecodes[0]} - ${currentTrack.timecodes[1]}`}
                                                                            </div>
                                                                        )}
                                                                        <div
                                                                            className={
                                                                                theme.timeline
                                                                            }
                                                                        >
                                                                            {/* Display current time */}
                                                                            <span>
                                                                                {formatTime(
                                                                                    currentTime,
                                                                                )}
                                                                            </span>

                                                                            {/* Timeline progress bar */}
                                                                            <div
                                                                                className={
                                                                                    theme.timeline_line
                                                                                }
                                                                            >
                                                                                <div
                                                                                    className={
                                                                                        theme.timeline_progress
                                                                                    }
                                                                                    style={{
                                                                                        width: `${progress}%`,
                                                                                    }}
                                                                                ></div>
                                                                            </div>

                                                                            {/* Display track end time */}
                                                                            <span>
                                                                                {formatTime(
                                                                                    trackEnd,
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div
                                                                    className={
                                                                        theme.flex_container
                                                                    }
                                                                >
                                                                    <Skeleton
                                                                        width={
                                                                            58
                                                                        }
                                                                        height={
                                                                            58
                                                                        }
                                                                    />
                                                                    <div
                                                                        className={
                                                                            theme.gap
                                                                        }
                                                                    >
                                                                        <Skeleton
                                                                            width={
                                                                                190
                                                                            }
                                                                            height={
                                                                                16
                                                                            }
                                                                        />
                                                                        <Skeleton
                                                                            width={
                                                                                80
                                                                            }
                                                                            height={
                                                                                16
                                                                            }
                                                                        />
                                                                        <div
                                                                            className={
                                                                                theme.timeline
                                                                            }
                                                                        >
                                                                            <Skeleton
                                                                                width={
                                                                                    200
                                                                                }
                                                                                height={
                                                                                    6
                                                                                }
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div
                                                            className={
                                                                theme.buttonRpc
                                                            }
                                                        >
                                                            <div
                                                                className={
                                                                    theme.button
                                                                }
                                                                onClick={() => {
                                                                    setRickRoll(
                                                                        !rickRollClick,
                                                                    )
                                                                }}
                                                            >
                                                                {app.discordRpc
                                                                    .button
                                                                    .length > 0
                                                                    ? app
                                                                          .discordRpc
                                                                          .button
                                                                    : '✌️ Open in Yandex Music'}
                                                            </div>
                                                            {rickRollClick && (
                                                                <video
                                                                    width="600"
                                                                    autoPlay
                                                                    loop
                                                                >
                                                                    <source
                                                                        src="https://s3.pulsesync.dev/files/heheheha.mp4"
                                                                        type="video/mp4"
                                                                    />
                                                                </video>
                                                            )}
                                                            <div
                                                                className={
                                                                    theme.button
                                                                }
                                                                onClick={() => {
                                                                    window.open(
                                                                        'https://github.com/PulseSync-LLC/YMusic-DRPC/tree/patcher-ts',
                                                                    )
                                                                }}
                                                            >
                                                                ♡ PulseSync
                                                                Project
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className={styles.options}>
                                                    <div
                                                        className={
                                                            inputStyle.textInputContainer
                                                        }
                                                    >
                                                        <div>App ID</div>
                                                        <input
                                                            type="text"
                                                            name="appId"
                                                            aria-errormessage={
                                                                (
                                                                    formik.errors as any
                                                                )['appId']
                                                            }
                                                            placeholder="984031241357647892"
                                                            className={
                                                                inputStyle.styledInput
                                                            }
                                                            value={
                                                                formik.values
                                                                    .appId
                                                            }
                                                            onChange={
                                                                formik.handleChange
                                                            }
                                                            onBlur={e => {
                                                                outInputChecker(
                                                                    e,
                                                                )
                                                            }}
                                                        />
                                                        {formik.touched.appId &&
                                                        formik.errors.appId ? (
                                                            <div
                                                                className={
                                                                    inputStyle.error
                                                                }
                                                            >
                                                                {
                                                                    formik
                                                                        .errors
                                                                        .appId
                                                                }
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <div
                                                        className={
                                                            inputStyle.textInputContainer
                                                        }
                                                    >
                                                        <div>Details</div>
                                                        <input
                                                            type="text"
                                                            name="details"
                                                            placeholder="enter text"
                                                            className={
                                                                inputStyle.styledInput
                                                            }
                                                            value={
                                                                formik.values
                                                                    .details
                                                            }
                                                            onChange={
                                                                formik.handleChange
                                                            }
                                                            onBlur={e => {
                                                                outInputChecker(
                                                                    e,
                                                                )
                                                            }}
                                                        />
                                                        {formik.touched
                                                            .details &&
                                                        formik.errors
                                                            .details ? (
                                                            <div
                                                                className={
                                                                    inputStyle.error
                                                                }
                                                            >
                                                                {
                                                                    formik
                                                                        .errors
                                                                        .details
                                                                }
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <div
                                                        className={
                                                            inputStyle.textInputContainer
                                                        }
                                                    >
                                                        <div>State</div>
                                                        <input
                                                            type="text"
                                                            name="state"
                                                            placeholder="enter text"
                                                            className={
                                                                inputStyle.styledInput
                                                            }
                                                            value={
                                                                formik.values
                                                                    .state
                                                            }
                                                            onChange={
                                                                formik.handleChange
                                                            }
                                                            onBlur={e => {
                                                                outInputChecker(
                                                                    e,
                                                                )
                                                            }}
                                                        />
                                                        {formik.touched.state &&
                                                        formik.errors.state ? (
                                                            <div
                                                                className={
                                                                    inputStyle.error
                                                                }
                                                            >
                                                                {
                                                                    formik
                                                                        .errors
                                                                        .state
                                                                }
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className={styles.options}>
                                                    <CheckboxNav
                                                        checkType="enableRpcButtonListen"
                                                        description="Активируйте этот параметр, чтобы ваш текущий статус отображался в Discord."
                                                    >
                                                        Включить кнопку
                                                        (Слушать)
                                                    </CheckboxNav>
                                                    <div
                                                        className={
                                                            inputStyle.textInputContainer
                                                        }
                                                    >
                                                        <div>Button</div>
                                                        <input
                                                            type="text"
                                                            name="button"
                                                            placeholder="enter text"
                                                            className={
                                                                inputStyle.styledInput
                                                            }
                                                            value={
                                                                formik.values
                                                                    .button
                                                            }
                                                            onChange={
                                                                formik.handleChange
                                                            }
                                                            onBlur={e => {
                                                                outInputChecker(
                                                                    e,
                                                                )
                                                            }}
                                                        />
                                                        {formik.touched
                                                            .button &&
                                                        formik.errors.button ? (
                                                            <div
                                                                className={
                                                                    inputStyle.error
                                                                }
                                                            >
                                                                {
                                                                    formik
                                                                        .errors
                                                                        .button
                                                                }
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <CheckboxNav
                                                        disabled={
                                                            !user.badges.some(
                                                                badge =>
                                                                    badge.type ===
                                                                    'supporter',
                                                            )
                                                        }
                                                        checkType="enableGithubButton"
                                                        description="Активируйте этот параметр, чтобы показать что вы любите разработчиков."
                                                    >
                                                        Включить кнопку
                                                        (PulseSync Project)
                                                    </CheckboxNav>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div
                                        className={styles.user_container}
                                        onClick={toggleUserContainer}
                                    >
                                        <div className={styles.user_avatar}>
                                            <img
                                                className={styles.avatar}
                                                src={user.avatar}
                                                alt=""
                                            />
                                            <div className={styles.status}>
                                                <div
                                                    className={styles.dot}
                                                ></div>
                                            </div>
                                        </div>
                                        <div className={styles.user_info}>
                                            <div className={styles.username}>
                                                {user.username}
                                            </div>
                                            <div className={styles.status_text}>
                                                {renderPlayerStatus()}
                                            </div>
                                        </div>
                                    </div>
                                    {isUserCardOpen && (
                                        <div className={styles.user_menu}>
                                            <div className={styles.user_info}>
                                                <img
                                                    className={
                                                        styles.user_banner
                                                    }
                                                    src={
                                                        user.banner
                                                            ? user.banner
                                                            : 'https://i.pinimg.com/originals/36/5e/66/365e667dfc1b90180dc16b595e8f1c88.gif'
                                                    }
                                                    alt=""
                                                />
                                                <div
                                                    className={
                                                        styles.user_avatar
                                                    }
                                                >
                                                    <img
                                                        className={
                                                            styles.avatar
                                                        }
                                                        src={user.avatar}
                                                        alt=""
                                                    />
                                                    <div
                                                        className={
                                                            styles.status
                                                        }
                                                    >
                                                        <div
                                                            className={
                                                                styles.dot
                                                            }
                                                        ></div>
                                                    </div>
                                                </div>
                                                <div
                                                    className={
                                                        styles.user_details
                                                    }
                                                >
                                                    <div
                                                        className={
                                                            styles.user_info
                                                        }
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
                                                                styles.status_text
                                                            }
                                                        >
                                                            {renderPlayerStatus()}
                                                            {playStatus ===
                                                                'play' && (
                                                                <>
                                                                    :{' '}
                                                                    {currentTrack?.playerBarTitle ||
                                                                        'No Title'}{' '}
                                                                    -{' '}
                                                                    {currentTrack?.artist ||
                                                                        'Unknown Artist'}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.badges_container
                                                        }
                                                    >
                                                        {user.badges.length >
                                                            0 &&
                                                            user.badges.map(
                                                                _badge => (
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
                                                                ),
                                                            )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div
                                                className={
                                                    styles.user_menu_buttons
                                                }
                                            >
                                                <button
                                                    className={
                                                        styles.menu_button
                                                    }
                                                    disabled
                                                >
                                                    Друзья
                                                </button>
                                                <button
                                                    className={
                                                        styles.menu_button
                                                    }
                                                    disabled
                                                >
                                                    Настройки
                                                </button>
                                                <button
                                                    className={
                                                        styles.menu_button
                                                    }
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
                                onClick={() =>
                                    window.electron.window.minimize()
                                }
                            >
                                <Minus color="#E4E5EA" />
                            </button>
                            <button
                                id="minimize"
                                className={styles.button_title}
                                onClick={() =>
                                    window.electron.window.maximize()
                                }
                            >
                                <Minimize color="#E4E5EA" />
                            </button>
                            <button
                                id="close"
                                className={styles.button_title}
                                onClick={() => window.electron.window.close()}
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

export default Header
