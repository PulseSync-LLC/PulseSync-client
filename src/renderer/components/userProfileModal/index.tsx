import {
    useEffect,
    useState,
    FC,
    JSXElementConstructor,
    Key,
    ReactElement,
    ReactNode,
    ReactPortal,
} from 'react'
import apolloClient from '../../api/apolloClient'
import config from '../../api/config'

import findUserByName from '../../api/queries/user/findUserByName.query'
import getAchievements from '../../api/queries/user/getAchievements.query'

import userInitials from '../../api/initials/user.initials'
import UserInterface from '../../api/interfaces/user.interface'

import Button from '../button'
import TooltipButton from '../tooltip_button'
import {
    MdCheckCircle,
    MdHistoryEdu,
    MdKeyboardArrowDown,
    MdMoreHoriz,
    MdOpenInBrowser,
    MdPersonAdd,
    MdSettings,
    MdStar,
} from 'react-icons/md'

import * as styles from './userProfileModal.module.scss'
import * as achv from './achievements.module.scss'

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
    const [expandedIndexes, setExpandedIndexes] = useState<number[]>([])

    const [user, setUser] = useState<UserInterface>(userInitials)
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<any>(null)

    const [bannerHeight, setBannerHeight] = useState<number>(184)
    const [bannerExpanded, setBannerExpanded] = useState<boolean>(false)

    const [shouldRender, setShouldRender] = useState(isOpen)
    const [animationClass, setAnimationClass] = useState(styles.closed)

    const [allAchievements, setAllAchievements] = useState<any[]>([])
    const [allAchievementsLoading, setAllAchievementsLoading] =
        useState<boolean>(false)
    const [allAchievementsError, setAllAchievementsError] = useState<any>(null)

    const toggleExpand = (id: number) => {
        setExpandedIndexes((prevIndexes) =>
            prevIndexes.includes(id)
                ? prevIndexes.filter((i) => i !== id)
                : [...prevIndexes, id],
        )
    }

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
                if (!res.data.findUserByName) {
                    setError('User not found')
                } else {
                    setUser(res.data.findUserByName)
                }
            })
            .catch(setError)
            .finally(() => setLoading(false))
    }, [isOpen, username])

    useEffect(() => {
        setAllAchievementsLoading(true)
        apolloClient
            .query({
                query: getAchievements,
                variables: {
                    page: 1,
                    pageSize: 100,
                    search: '',
                    sortOptions: [],
                },
                fetchPolicy: 'no-cache',
            })
            .then((res) => {
                if (res.data?.getAchievements?.achievements) {
                    setAllAchievements(res.data.getAchievements.achievements)
                }
            })
            .catch((err) => {
                setAllAchievementsError(err)
            })
            .finally(() => {
                setAllAchievementsLoading(false)
            })
    }, [])

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

    const renderAchievementItem = (ach: {
        points: ReactNode
        description: ReactNode
        hint: any
        id: number
        progressTotal: any
        difficulty: string
        imageUrl: any
        title: any
        criteria: {}
    }) => {
        const userAch = user.userAchievements?.find(
            (ua) => ua.achievement.id === ach.id,
        )

        const statusLower = userAch?.status?.toLowerCase() || 'not_started'
        const progressCurrent = userAch?.progressCurrent ?? 0
        const progressTotal = userAch?.progressTotal ?? ach.progressTotal ?? 0
        const isCompleted = statusLower === 'completed'
        const isInProgress = statusLower === 'in_progress'

        type Difficulty = 'EASY' | 'NORMAL' | 'HARD' | 'EXTREME'

        const difficultyMap: Record<Difficulty, string> = {
            EASY: 'Легко',
            NORMAL: 'Нормально',
            HARD: 'Сложно',
            EXTREME: 'Экстремально',
        }

        const difficultyLabel =
            difficultyMap[
                ach.difficulty.toUpperCase() as keyof typeof difficultyMap
            ] ?? 'Неизвестно'

        const difficultyColors = {
            EASY: '#92FFB2',
            NORMAL: '#E9CA75',
            HARD: '#FF9292',
            EXTREME: '#BA82FF',
        }

        const difficultyColor =
            difficultyColors[
                ach.difficulty.toUpperCase() as keyof typeof difficultyColors
            ] || '#000000'

        const itemClassNames = [
            achv.achievementCard,
            isCompleted && achv.completed,
            isInProgress && achv.inProgress,
        ]
            .filter(Boolean)
            .join(' ')

        return (
            <div key={ach.id} className={itemClassNames}>
                <div className={achv.achievementHeader}>
                    {!isCompleted ? (
                        <div className={achv.image}>?</div>
                    ) : (
                        <div className={achv.image}>
                            <div className={achv.imageSolid}>
                                <MdCheckCircle size={24} />
                            </div>
                            <img
                                className={achv.image}
                                src={
                                    ach.imageUrl ||
                                    'static/assets/images/achievement_placeholder.png'
                                }
                                onError={(e) => {
                                    ;(e.currentTarget as HTMLImageElement).src =
                                        'static/assets/images/achievement_placeholder.png'
                                }}
                                alt={ach.title}
                            />
                        </div>
                    )}
                    <div className={achv.achievementInfo}>
                        {isCompleted && (
                            <div className={achv.achievementCompletedAt}>
                                {userAch?.completedAt
                                    ? new Date(
                                          userAch.completedAt,
                                      ).toLocaleDateString()
                                    : 'Неизвестно'}
                            </div>
                        )}
                        <div className={achv.achievementTitle}>{ach.title}</div>
                        <div className={achv.contentWrapper}>
                            <div className={achv.achievementDescription}>
                                {ach.description}
                            </div>
                        </div>
                    </div>
                    <div className={achv.buttonsItem}>
                        {ach.hint && (
                            <TooltipButton
                                styleComponent={{
                                    maxWidth: 300,
                                }}
                                className={achv.expandButton}
                                tooltipText={ach.hint}
                                side="left"
                            >
                                <MdHistoryEdu size={24} />
                            </TooltipButton>
                        )}
                        {isInProgress || isCompleted ? (
                            <button
                                className={achv.expandButton}
                                onClick={() => toggleExpand(ach.id)}
                            >
                                <MdKeyboardArrowDown
                                    size={24}
                                    className={
                                        expandedIndexes.includes(ach.id)
                                            ? achv.rotatedArrow
                                            : ''
                                    }
                                />
                            </button>
                        ) : null}
                    </div>
                </div>

                {expandedIndexes.includes(ach.id) &&
                    userAch?.criteriaProgress &&
                    Array.isArray(userAch.criteriaProgress) &&
                    userAch.criteriaProgress.length > 0 && (
                        <div className={achv.trackList}>
                            {userAch.criteriaProgress.map((crit: any) => {
                                return (
                                    <div
                                        key={crit.id}
                                        className={`${achv.trackItem} ${
                                            crit.isCompleted ? achv.criteriaDone : ''
                                        }`}
                                    >
                                        {crit.isCompleted ? crit.name : 'Неизвестно'}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                <div className={achv.achievementFooter}>
                    {!isCompleted && (
                        <div
                            className={achv.goal}
                            style={{ color: difficultyColor }}
                        >
                            Прогресс: {progressCurrent} / {progressTotal}
                        </div>
                    )}
                    <div className={achv.points} style={{ color: difficultyColor }}>
                        <MdStar /> {ach.points} очков
                    </div>
                    <div
                        className={achv.difficulty}
                        style={{ color: difficultyColor }}
                    >
                        {difficultyLabel}
                    </div>
                </div>
            </div>
        )
    }

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
        if (loading) {
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
        }

        if (error) {
            return <p>Ошибка: {error?.message || String(error)}</p>
        }

        if (!user || !user.id || user.id === '-1') {
            return <p>Пользователь не найден</p>
        }

        const bannerUrl = `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
        const avatarUrl = `${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`
        const statusColor = getStatusColor(user)
        const statusTooltip = getStatusTooltip(user)

        return (
            <>
                {/* <div
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
                        {new Date(user.createdAt) <= new Date(2025, 0, 17) ? (
                            <TooltipButton
                                styleComponent={{
                                    padding: 0,
                                    background: 'transparent',
                                }}
                                tooltipText={
                                    <div className={styles.dateCreateTooltip}>
                                        {new Date(user.createdAt).toLocaleString(
                                            'ru-RU',
                                            {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                            },
                                        )}
                                    </div>
                                }
                                side="top"
                            >
                                Здесь с самого начала
                            </TooltipButton>
                        ) : (
                            <TooltipButton
                                styleComponent={{
                                    padding: 0,
                                    background: 'transparent',
                                }}
                                tooltipText={
                                    <div className={styles.dateCreateTooltip}>
                                        {new Date(user.createdAt).toLocaleString(
                                            'ru-RU',
                                            {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                            },
                                        )}
                                    </div>
                                }
                                side="top"
                            >
                                Дата регистрации:{' '}
                                {new Date(user.createdAt).toLocaleDateString(
                                    'ru-RU',
                                    {
                                        month: 'long',
                                        year: 'numeric',
                                    },
                                )}
                            </TooltipButton>
                        )}
                    </div>
                </div> */}

                <div
                    className={styles.bannerBackground}
                    style={{
                        background: `linear-gradient(180deg, rgba(41, 44, 54, 0) 0%, #292C36 100%), url(${bannerUrl})`,
                        backgroundSize: 'cover',
                    }}
                >
                    <div className={styles.userImage}>
                        <img
                            className={styles.avatarWrapper}
                            src={avatarUrl}
                            alt="Avatar"
                            onError={(e) => {
                                ;(e.currentTarget as HTMLImageElement).src =
                                    './static/assets/images/undef.png'
                            }}
                            width="84"
                            height="84"
                        />
                        <div className={styles.userInfo}>
                            <div className={styles.dateCreate}>
                                {new Date(user.createdAt) <=
                                new Date(2025, 0, 17) ? (
                                    <TooltipButton
                                        styleComponent={{
                                            padding: 0,
                                            background: 'transparent',
                                        }}
                                        tooltipText={
                                            <div
                                                className={styles.dateCreateTooltip}
                                            >
                                                {new Date(
                                                    user.createdAt,
                                                ).toLocaleString('ru-RU', {
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                })}
                                            </div>
                                        }
                                        side="top"
                                    >
                                        Здесь с самого начала
                                    </TooltipButton>
                                ) : (
                                    <TooltipButton
                                        styleComponent={{
                                            padding: 0,
                                            background: 'transparent',
                                        }}
                                        tooltipText={
                                            <div
                                                className={styles.dateCreateTooltip}
                                            >
                                                {new Date(
                                                    user.createdAt,
                                                ).toLocaleString('ru-RU', {
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                })}
                                            </div>
                                        }
                                        side="top"
                                    >
                                        Дата регистрации:{' '}
                                        {new Date(user.createdAt).toLocaleDateString(
                                            'ru-RU',
                                            {
                                                month: 'long',
                                                year: 'numeric',
                                            },
                                        )}
                                    </TooltipButton>
                                )}
                            </div>
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
                                                    key={_badge.uuid}
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
                    <div className={styles.userButtons}>
                        <Button className={styles.buttonAddFriend}>
                            <MdPersonAdd size={20} /> Добавить в друзья
                        </Button>
                        <Button className={styles.buttonPersonal}>
                            <MdSettings size={20} />
                        </Button>
                        <Button className={styles.buttonPersonal}>
                            <MdMoreHoriz size={20} />
                        </Button>
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
                                                    `yandexmusic://album/${encodeURIComponent(
                                                        albumId,
                                                    )}/track/${
                                                        user.currentTrack.realId
                                                    }`,
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

                {/* <div className={styles.userInfo}>
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
                                                        key={_badge.uuid}
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
                </div> */}

                <div></div>

                <div className={styles.achievementsSection}>
                    <h2>Достижения</h2>

                    {allAchievementsLoading && <p>Загрузка достижений...</p>}
                    {allAchievementsError && (
                        <p>
                            Ошибка при загрузке достижений:{' '}
                            {allAchievementsError.message ||
                                String(allAchievementsError)}
                        </p>
                    )}

                    {!allAchievementsLoading && allAchievements.length > 0 && (
                        <>
                            <h3>Выполненные</h3>
                            <div className={styles.achievementsList}>
                                {allAchievements
                                    .filter((ach) => {
                                        const userAch = user.userAchievements?.find(
                                            (ua) => ua.achievement.id === ach.id,
                                        )
                                        return (
                                            userAch?.status?.toLowerCase() ===
                                            'completed'
                                        )
                                    })
                                    .sort((a, b) => {
                                        const difficultyPriority = {
                                            EASY: 1,
                                            NORMAL: 2,
                                            HARD: 3,
                                            EXTREME: 4,
                                        }

                                        return (
                                            difficultyPriority[
                                                a.difficulty.toUpperCase() as keyof typeof difficultyPriority
                                            ] -
                                            difficultyPriority[
                                                b.difficulty.toUpperCase() as keyof typeof difficultyPriority
                                            ]
                                        )
                                    })
                                    .map((ach) => renderAchievementItem(ach))}
                            </div>

                            <h3>Неполученные достижения</h3>
                            <div className={styles.achievementsList}>
                                {allAchievements
                                    .filter((ach) => {
                                        const userAch = user.userAchievements?.find(
                                            (ua) => ua.achievement.id === ach.id,
                                        )
                                        return (
                                            !userAch ||
                                            userAch?.status?.toLowerCase() ===
                                                'not_started' ||
                                            userAch?.status?.toLowerCase() ===
                                                'in_progress'
                                        )
                                    })
                                    .sort((a, b) => {
                                        const userAchA = user.userAchievements?.find(
                                            (ua) => ua.achievement.id === a.id,
                                        )
                                        const userAchB = user.userAchievements?.find(
                                            (ua) => ua.achievement.id === b.id,
                                        )

                                        const difficultyPriority = {
                                            EASY: 1,
                                            NORMAL: 2,
                                            HARD: 3,
                                            EXTREME: 4,
                                        }

                                        if (
                                            userAchA?.status?.toLowerCase() ===
                                                'in_progress' &&
                                            userAchB?.status?.toLowerCase() !==
                                                'in_progress'
                                        ) {
                                            return -1
                                        }
                                        if (
                                            userAchB?.status?.toLowerCase() ===
                                                'in_progress' &&
                                            userAchA?.status?.toLowerCase() !==
                                                'in_progress'
                                        ) {
                                            return 1
                                        }

                                        return (
                                            difficultyPriority[
                                                a.difficulty.toUpperCase() as keyof typeof difficultyPriority
                                            ] -
                                            difficultyPriority[
                                                b.difficulty.toUpperCase() as keyof typeof difficultyPriority
                                            ]
                                        )
                                    })
                                    .map((ach) => renderAchievementItem(ach))}
                            </div>
                        </>
                    )}
                </div>
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
