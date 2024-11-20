import * as styles from './header.module.scss'
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
import Modal from '../modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import * as modalStyles from '../modal/modal.modules.scss'
import playerContext from '../../../renderer/api/context/player.context'
import TrackInterface from '../../api/interfaces/track.interface'

interface p {
    goBack?: boolean
}

interface DataTrack {
    playerBarTitle: string
    artist: string
    album?: string
    timecodes: [number, number]
    requestImgTrack: string[]
    linkTitle: string | number
    url: string
    id: string
}

const Header: React.FC<p> = ({ goBack }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isUserCardOpen, setIsUserCardOpen] = useState(false)
    const { user, appInfo, app } = useContext(userContext)
    const { currentTrack } = useContext(playerContext)
    const [modal, setModal] = useState(false)
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

    const [playStatus, setPlayStatus] = useState<'play' | 'pause' | null>(null)

    const statusColors = {
        play: '#62FF79',
        pause: '#60C2FF',
        default: '#60C2FF',
    }

    useEffect(() => {
        const handleDataUpdate = (data: TrackInterface) => {
            if (data) {
                if (data.status === 'play') {
                    setPlayStatus('play')
                } else if (data.status === 'pause') {
                    setPlayStatus('pause')
                }
            }
        }
        handleDataUpdate(currentTrack)
    }, [currentTrack])

    useEffect(() => {
        const color = statusColors[playStatus] || statusColors.default
        document.documentElement.style.setProperty('--statusColor', color)
    }, [playStatus])

    const renderPlayerStatus = () => {
        if (playStatus === 'play') {
            return 'Слушает'
        } else if (playStatus === 'pause') {
            return 'Думает'
        } else {
            return 'Думает'
        }
    }

    useEffect(() => {
        if (typeof window !== 'undefined' && window.desktopEvents) {
            window.desktopEvents?.invoke('needModalUpdate').then(value => {
                if (value) {
                    openModal()
                }
            })
        }
    }, [])

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
            <header className={styles.nav_bar}>
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
                                    <div className={styles.rpcStatus}>
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
                                        <span className={styles.tooltip}>
                                            Скоро
                                        </span>
                                    </div>
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
                                            <div className={styles.user_menu_buttons}>
                                                <button className={styles.menu_button} disabled>Друзья</button>
                                                <button className={styles.menu_button} disabled>Настройки</button>
                                                <button className={styles.menu_button}>Выйти</button>
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
