import { useEffect, useState, FC } from 'react'
import apolloClient from '../../api/apolloClient'
import config from '../../api/config'
import findUserByName from '../../api/queries/user/findUserByName.query'
import userInitials from '../../api/initials/user.initials'
import UserInterface from '../../api/interfaces/user.interface'

import Button from '../button'
import TooltipButton from '../tooltip_button'
import {
    MdKeyboardArrowDown,
    MdMoreHoriz,
    MdOpenInBrowser,
    MdPersonAddAlt1,
} from 'react-icons/md'

import * as styles from './userProfileModal.module.scss'
import { getStatusColor, getStatusTooltip } from '../../utils/userStatus'
import { motion } from 'framer-motion'

interface UserProfileModalProps {
    isOpen: boolean
    onClose: () => void
    username: string
}

const UserProfileModal: FC<UserProfileModalProps> = ({
    isOpen,
    onClose,
    username,
}) => {
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<any>(null)
    const [bannerHeight, setBannerHeight] = useState<number>(184)
    const [bannerExpanded, setBannerExpanded] = useState<boolean>(false)
    const [shouldRender, setShouldRender] = useState(isOpen)
    const [animationClass, setAnimationClass] = useState(styles.closed)

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true)
        } else {
            const timer = setTimeout(() => setShouldRender(false), 300)
            return () => clearTimeout(timer)
        }
    }, [isOpen])

    useEffect(() => {
        if (isOpen) {
            setAnimationClass(styles.closed)
            requestAnimationFrame(() => {
                setAnimationClass(styles.open)
            })
        } else {
            setAnimationClass(styles.closed)
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen || !username) return

        setUser(userInitials)
        setLoading(true)
        setError(null)

        apolloClient
            .query({
                query: findUserByName,
                variables: { name: username },
                fetchPolicy: 'no-cache',
            })
            .then((res) => {
                if (res.data.findUserByName === null) {
                    setError('User not found')
                } else {
                    setUser(res.data.findUserByName)
                }
            })
            .catch(setError)
            .finally(() => setLoading(false))
    }, [isOpen, username])

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null
        const targetHeight = bannerExpanded ? 300 : 184
        const step = bannerExpanded ? -1 : 1

        interval = setInterval(() => {
            setBannerHeight((prev) => {
                if (
                    (step < 0 && prev <= targetHeight) ||
                    (step > 0 && prev >= targetHeight)
                ) {
                    if (interval) clearInterval(interval)
                    return targetHeight
                }
                return prev + step
            })
        }, 5)

        return () => {
            if (interval) clearInterval(interval)
        }
    }, [bannerExpanded])

    const toggleBanner = () => setBannerExpanded((prev) => !prev)

    if (!shouldRender) return null

    const loadingText = 'Загрузка...'.split('')
    const containerVariants = {
        animate: {
            transition: { staggerChildren: 0.1 },
        },
    }
    const letterVariants = {
        initial: { y: 0 },
        animate: {
            y: [0, -10, 0],
            transition: {
                y: {
                    repeat: Infinity,
                    repeatType: 'loop',
                    duration: 1,
                    ease: 'easeInOut',
                },
            },
        },
    }

    const renderContent = () => {
        if (loading)
            return (
                <div className={styles.loadingWrapper}>
                    <div className={styles.loading}>
                        <motion.div
                            variants={containerVariants}
                            initial="initial"
                            animate="animate"
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}
                        >
                            {loadingText.map((char, index) => (
                                <motion.span
                                    key={index}
                                    variants={letterVariants}
                                    style={{
                                        display: 'inline-block',
                                        marginRight: '2px',
                                    }}
                                >
                                    {char}
                                </motion.span>
                            ))}
                        </motion.div>
                    </div>
                </div>
            )
        if (error) return <p>Ошибка: {error?.message || String(error)}</p>
        if (!user || !user.id || user.id === '-1')
            return <p>Пользователь не найден</p>

        const bannerUrl = `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
        const avatarUrl = `${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`
        const statusColor = getStatusColor(user)
        const statusTooltip = getStatusTooltip(user)

        return (
            <>
                <div
                    className={styles.bannerBackground}
                    style={{
                        transition: 'height 0.5s ease',
                        backgroundImage: `url(${bannerUrl})`,
                        backgroundSize: 'cover',
                        height: `${bannerHeight}px`,
                    }}
                >
                    <Button
                        className={styles.hideButton}
                        onClick={toggleBanner}
                        title={
                            bannerExpanded ? 'Свернуть баннер' : 'Развернуть баннер'
                        }
                    >
                        <MdKeyboardArrowDown
                            size={20}
                            style={
                                bannerExpanded
                                    ? {
                                          transform: 'rotate(180deg)',
                                          transition: 'transform 0.3s ease',
                                      }
                                    : {
                                          transform: 'rotate(0deg)',
                                          transition: 'transform 0.3s ease',
                                      }
                            }
                        />
                    </Button>
                    <div className={styles.dateCreate}>
                        Дата регистрации:{' '}
                        {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                </div>

                <div className={styles.userInfo}>
                    <div className={styles.userHeader}>
                        <div className={styles.userContainerLeft}>
                            <div className={styles.userImage}>
                                <img
                                    className={styles.avatarWrapper}
                                    src={avatarUrl}
                                    alt="Avatar"
                                    onError={(e) => {
                                        ;(e.currentTarget as HTMLImageElement).src =
                                            './static/assets/images/undef.png'
                                    }}
                                    width="100"
                                    height="100"
                                />
                                <TooltipButton
                                    tooltipText={statusTooltip}
                                    side="top"
                                    className={styles.statusIndicator}
                                    style={{ backgroundColor: statusColor }}
                                >
                                    <></>
                                </TooltipButton>
                            </div>

                            <div className={styles.userInfoText}>
                                <div className={styles.userName}>
                                    {user.nickname || 'Без никнейма'}
                                    <div className={styles.userBadges}>
                                        {Array.isArray(user.badges) &&
                                            user.badges
                                                .sort((a, b) => b.level - a.level)
                                                .map((_badge) => (
                                                    <TooltipButton
                                                        tooltipText={_badge.name}
                                                        side="top"
                                                        className={styles.badge}
                                                        key={_badge.type}
                                                    >
                                                        <img
                                                            src={`static/assets/badges/${_badge.type}.svg`}
                                                            alt={_badge.type}
                                                        />
                                                    </TooltipButton>
                                                ))}
                                    </div>
                                </div>
                                <div className={styles.userUsername}>
                                    @{user.username}
                                </div>
                            </div>
                        </div>

                        <TooltipButton
                            className={styles.rightContainer}
                            tooltipText="Скоро"
                            side="top"
                        >
                            <Button disabled className={styles.defaultButton}>
                                <MdPersonAddAlt1 size={20} />
                            </Button>
                            <Button disabled className={styles.miniButton}>
                                <MdMoreHoriz size={20} />
                            </Button>
                        </TooltipButton>
                    </div>
                </div>

                {user.currentTrack && user.currentTrack.status === 'playing' && (
                    <TooltipButton
                        className={styles.buttonNowPlaying}
                        tooltipText={
                            <div className={styles.tarckInfo}>
                                {user.currentTrack.trackSource !== 'UGC' && (
                                    <>
                                        <div>
                                            <strong>Альбом:</strong>{' '}
                                            {user.currentTrack.albums
                                                .map((album) => album.title)
                                                .join(', ')}
                                        </div>
                                        <Button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                const albumId =
                                                    user.currentTrack.albums[0].id
                                                window.desktopEvents.send(
                                                    'open-external',
                                                    `yandexmusic://album/${encodeURIComponent(albumId)}/track/${user.currentTrack.realId}`,
                                                )
                                            }}
                                            className={styles.trackButton}
                                        >
                                            <MdOpenInBrowser size={24} /> Открыть в
                                            Яндекс.Музыке
                                        </Button>
                                    </>
                                )}
                            </div>
                        }
                        side="bottom"
                    >
                        <span className={styles.userDate}>
                            Слушает: {user.currentTrack.title} -{' '}
                            {user.currentTrack.artists
                                .map((artist) => artist.name)
                                .join(', ')}
                        </span>
                    </TooltipButton>
                )}
            </>
        )
    }

    return (
        <div className={`${styles.overlay} ${animationClass}`} onClick={onClose}>
            <div
                className={`${styles.modalContainer} ${animationClass}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.modalContent}>{renderContent()}</div>
            </div>
        </div>
    )
}

export default UserProfileModal
