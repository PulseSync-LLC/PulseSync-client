import React, { useState, useContext } from 'react'
import {
    MdCheckCircle,
    MdHistoryEdu,
    MdHowToReg,
    MdKeyboardArrowDown,
    MdMoreHoriz,
    MdOpenInNew,
    MdPeopleAlt,
    MdPersonAdd,
    MdPersonOff,
    MdPersonRemove,
    MdSettings,
    MdStar,
} from 'react-icons/md'
import apolloClient from '../../../api/apolloClient'
import toggleFollowMutation from '../../../api/mutations/toggleFollow.query'
import config from '../../../api/config'
import { getStatus, getStatusColor } from '../../../utils/userStatus'
import TooltipButton from '../../tooltip_button'
import Button from '../../button'
import LevelProgress from '../../LevelProgress'
import LevelBadge from '../../LevelBadge'
import userContext from '../../../api/context/user.context'

import * as styles from '../../userProfileModal/userProfileModal.module.scss'
import * as achv from '../../userProfileModal/achievements.module.scss'

import { ExtendedUser } from '../../userProfileModal'

interface ProfileTabProps {
    userProfile: ExtendedUser
    loading: boolean
    error: any
    username: string
}

const ProfileTab: React.FC<ProfileTabProps> = ({
    userProfile,
    loading,
    error,
    username,
}) => {
    const { user } = useContext(userContext)

    const [expandedIndexes, setExpandedIndexes] = useState<number[]>([])

    const [isHovered, setIsHovered] = useState(false)

    const [friendStatusLoading, setFriendStatusLoading] = useState(false)

    if (loading || friendStatusLoading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.loader}>
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                </div>
                <div>Загрузка...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div style={{ textAlign: 'center', padding: 20 }}>
                Ошибка: {String(error)}
            </div>
        )
    }
    if (!userProfile || !userProfile.id || userProfile.id === '-1') {
        return (
            <div style={{ textAlign: 'center', padding: 20 }}>
                Пользователь не найден
            </div>
        )
    }

    const handleToggleFollow = async () => {
        try {
            setFriendStatusLoading(true)
            const { data } = await apolloClient.mutate({
                mutation: toggleFollowMutation,
                variables: { targetId: userProfile.id },
            })
            if (data && data.toggleFollow) {
                userProfile.isFollowing = data.toggleFollow.isFollowing
                userProfile.isFriend = data.toggleFollow.areFriends
            }
        } catch (error) {
            console.error(
                'Ошибка при запросе на добавление/удаление из друзей',
                error,
            )
        } finally {
            setFriendStatusLoading(false)
        }
    }

    const renderFriendButton = () => {
        if (user.username === username) {
            return (
                <>
                    <Button className={styles.buttonAddFriend} disabled>
                        <MdPersonAdd size={20} /> Редактировать профиль
                    </Button>
                    <Button className={styles.buttonPersonal} disabled>
                        <MdSettings size={20} />
                    </Button>
                </>
            )
        }

        let buttonTextNormal = 'Добавить в друзья'
        let buttonTextHover = 'Подписаться'
        let normalIcon = <MdPersonAdd size={20} />
        let hoverIcon = <MdPersonAdd size={20} />
        let buttonClass = styles.buttonAddFriendWhite

        if (userProfile.isFriend) {
            buttonTextNormal = 'Друзья'
            buttonTextHover = 'Удалить из друзей'
            normalIcon = <MdPeopleAlt size={20} />
            hoverIcon = <MdPersonOff size={20} />
            buttonClass = styles.buttonRemoveFriend
        } else if (userProfile.isFollowing) {
            buttonTextNormal = 'Подписан'
            buttonTextHover = 'Отписаться'
            normalIcon = <MdHowToReg size={20} />
            hoverIcon = <MdPersonRemove size={20} />
            buttonClass = styles.buttonUnsubscribe
        }

        return (
            <Button
                type="button"
                disabled={false}
                className={`${styles.friendActionButton} ${buttonClass}`}
                onClick={handleToggleFollow}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {isHovered ? hoverIcon : normalIcon}{' '}
                {isHovered ? buttonTextHover : buttonTextNormal}
            </Button>
        )
    }

    const toggleExpand = (id: number) => {
        setExpandedIndexes((prev) =>
            prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
        )
    }

    const renderAchievementItem = (ach: any) => {
        const userAch = userProfile.userAchievements?.find(
            (ua) => ua.achievement.id === ach.id,
        )
        const statusLower = userAch?.status?.toLowerCase() || 'not_started'
        const progressCurrent = userAch?.progressCurrent ?? 0
        const progressTotal = userAch?.progressTotal ?? ach.progressTotal ?? 0
        const isCompleted = statusLower === 'completed'
        const isInProgress = statusLower === 'in_progress'

        const difficultyMap: Record<string, string> = {
            EASY: 'Легко',
            NORMAL: 'Нормально',
            HARD: 'Сложно',
            EXTREME: 'Экстремально',
        }
        const difficultyColors = {
            EASY: '#92FFB2',
            NORMAL: '#E9CA75',
            HARD: '#FF9292',
            EXTREME: '#BA82FF',
        } as const
        const difficultyLabel =
            difficultyMap[ach.difficulty.toUpperCase()] ?? 'Неизвестно'
        const difficultyColor =
            difficultyColors[
                ach.difficulty.toUpperCase() as keyof typeof difficultyColors
            ] || '#000'

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
                                src={ach.imageUrl || 'static/assets/images/O^O.png'}
                                onError={(e) => {
                                    ;(e.currentTarget as HTMLImageElement).src =
                                        'static/assets/images/O^O.png'
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
                                          Number(userAch.completedAt),
                                      ).toLocaleString('ru-RU', {
                                          year: 'numeric',
                                          month: 'long',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit',
                                      })
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
                                styleComponent={{ maxWidth: 300 }}
                                className={achv.expandButton}
                                tooltipText={ach.hint}
                                side="left"
                            >
                                <MdHistoryEdu size={24} />
                            </TooltipButton>
                        )}
                        {(isInProgress || isCompleted) &&
                            username === user.username && (
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
                            )}
                    </div>
                </div>

                {expandedIndexes.includes(ach.id) &&
                    userAch?.criteriaProgress &&
                    Array.isArray(userAch.criteriaProgress) &&
                    userAch.criteriaProgress.length > 0 &&
                    user.username === username && (
                        <div className={achv.trackList}>
                            {userAch.criteriaProgress.map((crit: any) => (
                                <div
                                    key={crit.id}
                                    className={`${achv.trackItem} ${
                                        crit.isCompleted ? achv.criteriaDone : ''
                                    }`}
                                >
                                    {crit.isCompleted ? crit.name : 'Неизвестно'}
                                </div>
                            ))}
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

    const statusColor = getStatusColor(userProfile)
    const statusColorDark = getStatusColor(userProfile, true)
    const statusUser = getStatus(userProfile, true)

    const bannerUrl = `${config.S3_URL}/banners/${userProfile.bannerHash}.${userProfile.bannerType}`
    const avatarUrl = `${config.S3_URL}/avatars/${userProfile.avatarHash}.${userProfile.avatarType}`

    return (
        <>
            {}
            <div
                onClick={(e) => {
                    if (
                        userProfile.currentTrack &&
                        userProfile.currentTrack.status === 'playing'
                    ) {
                        e.stopPropagation()
                        const albumId = userProfile.currentTrack.albums[0].id
                        window.desktopEvents?.send(
                            'open-external',
                            `yandexmusic://album/${encodeURIComponent(albumId)}/track/${userProfile.currentTrack.realId}`,
                        )
                    }
                }}
                style={
                    {
                        '--statusColorProfile': statusColor,
                        '--statusColorDark': statusColorDark,
                        cursor:
                            userProfile.currentTrack &&
                            userProfile.currentTrack.status === 'playing'
                                ? 'pointer'
                                : 'default',
                    } as React.CSSProperties
                }
                className={`${styles.userStatusInfo} ${
                    userProfile.currentTrack &&
                    userProfile.currentTrack.status === 'playing'
                        ? styles.hoverEffect
                        : ''
                }`}
            >
                {userProfile.currentTrack &&
                userProfile.currentTrack.status === 'playing'
                    ? `Слушает: ${statusUser}`
                    : statusUser}
                {userProfile.currentTrack &&
                    userProfile.currentTrack.status === 'playing' && (
                        <MdOpenInNew size={20} />
                    )}
            </div>

            {}
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
                            {new Date(userProfile.createdAt) <=
                            new Date(2025, 0, 17) ? (
                                <TooltipButton
                                    styleComponent={{
                                        padding: 0,
                                        background: 'transparent',
                                    }}
                                    tooltipText={
                                        <div className={styles.dateCreateTooltip}>
                                            {new Date(
                                                userProfile.createdAt,
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
                                        <div className={styles.dateCreateTooltip}>
                                            {new Date(
                                                userProfile.createdAt,
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
                                    {new Date(
                                        userProfile.createdAt,
                                    ).toLocaleDateString('ru-RU', {
                                        month: 'long',
                                        year: 'numeric',
                                    })}
                                </TooltipButton>
                            )}
                        </div>
                        <div className={styles.userName}>
                            {userProfile.nickname || 'Без никнейма'}
                            <div className={styles.userBadges}>
                                {}
                                <TooltipButton
                                    tooltipText={`Уровень ${userProfile.levelInfo.currentLevel}`}
                                    side="top"
                                >
                                    <LevelBadge
                                        level={userProfile.levelInfo.currentLevel}
                                    />
                                </TooltipButton>

                                {}
                                {Array.isArray(userProfile.badges) &&
                                    userProfile.badges
                                        .sort((a, b) => b.level - a.level)
                                        .map((badge) => (
                                            <TooltipButton
                                                tooltipText={badge.name}
                                                side="top"
                                                className={styles.badge}
                                                key={badge.uuid}
                                            >
                                                <img
                                                    src={`static/assets/badges/${badge.type}.svg`}
                                                    alt={badge.type}
                                                />
                                            </TooltipButton>
                                        ))}
                            </div>
                        </div>
                        <div className={styles.userUsername}>
                            @{userProfile.username}
                        </div>
                    </div>
                </div>
                <div className={styles.userButtons}>
                    {renderFriendButton()}
                    <Button className={styles.buttonPersonal}>
                        <MdMoreHoriz size={20} />
                    </Button>
                </div>
            </div>

            {}
            <div className={styles.userPageDown}>
                <div className={styles.achievementsSection}>
                    <div>
                        <div className={styles.titleHeader}>Достижения</div>
                        <div className={styles.descriptionHeader}>
                            Достигайте самого высокого уровня.
                        </div>
                    </div>

                    {}
                    <LevelProgress
                        totalPoints={userProfile.levelInfo.totalPoints}
                        currentLevel={userProfile.levelInfo.currentLevel}
                        progressInCurrentLevel={
                            userProfile.levelInfo.progressInCurrentLevel
                        }
                        currentLevelThreshold={
                            userProfile.levelInfo.currentLevelThreshold
                        }
                    />

                    {userProfile.allAchievements &&
                    userProfile.allAchievements.length > 0 ? (
                        <>
                            {}
                            <div className={styles.achievementsListContainer}>
                                <div className={styles.achievementsListTitle}>
                                    Выполненные
                                </div>
                                <div className={styles.achievementsList}>
                                    {userProfile.allAchievements
                                        .filter((ach) => {
                                            const userAch =
                                                userProfile.userAchievements?.find(
                                                    (ua) =>
                                                        ua.achievement.id === ach.id,
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
                                {userProfile.allAchievements.filter((ach) => {
                                    const userAch =
                                        userProfile.userAchievements?.find(
                                            (ua) => ua.achievement.id === ach.id,
                                        )
                                    return (
                                        userAch?.status?.toLowerCase() ===
                                        'completed'
                                    )
                                }).length === 0 && (
                                    <div className={styles.noAchievementsMessage}>
                                        🎯 Пока нет выполненных достижений
                                    </div>
                                )}
                            </div>

                            {}
                            <div className={styles.achievementsListContainer}>
                                <div className={styles.achievementsListTitle}>
                                    Неполученные достижения
                                </div>
                                <div className={styles.achievementsList}>
                                    {userProfile.allAchievements
                                        .filter((ach) => {
                                            const userAch =
                                                userProfile.userAchievements?.find(
                                                    (ua) =>
                                                        ua.achievement.id === ach.id,
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
                                            const userAchA =
                                                userProfile.userAchievements?.find(
                                                    (ua) =>
                                                        ua.achievement.id === a.id,
                                                )
                                            const userAchB =
                                                userProfile.userAchievements?.find(
                                                    (ua) =>
                                                        ua.achievement.id === b.id,
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
                            </div>
                        </>
                    ) : (
                        <p>Нет достижений</p>
                    )}
                </div>
            </div>
        </>
    )
}

export default ProfileTab
