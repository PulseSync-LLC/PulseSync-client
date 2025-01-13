import React, { useEffect, useState } from 'react'
import apolloClient from '../../api/apolloClient'
import config from '../../api/config'
import findUserByName from '../../api/queries/user/findUserByName.query'
import userInitials from '../../api/initials/user.initials'
import UserInterface from '../../api/interfaces/user.interface'

import Button from '../button'
import TooltipButton from '../tooltip_button'

import { MdKeyboardArrowDown, MdMoreHoriz } from 'react-icons/md'

import * as styles from './userProfileModal.module.scss'

interface UserProfileModalProps {
    isOpen: boolean

    onClose: () => void

    username: string
}

function getStatusColor(user: UserInterface) {
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        return 'orange'
    }

    if (user.status === 'online') {
        return '#48ff00'
    }

    return '#888'
}

function getStatusTooltip(user: UserInterface) {
    console.log(user)
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        if (user.currentTrack.title) {
            const artists = user.currentTrack.artists
                ?.map((artist) => artist.name)
                .join(', ')
            return `Слушает: ${user.currentTrack.title} — ${artists}`
        }
        return 'Слушает музыку'
    }

    if (user.status === 'online') {
        return 'Сейчас в сети'
    }

    if (user.lastOnline) {
        return `Не в сети (был: ${user.lastOnline})`
    }
    return 'Не в сети'
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
    isOpen,
    onClose,
    username,
}) => {
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<any>(null)

    const [bannerHeight, setBannerHeight] = useState(184)
    const [bannerExpanded, setBannerExpanded] = useState(false)

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
            .catch((err) => setError(err))
            .finally(() => setLoading(false))
    }, [isOpen, username])

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null
        const targetHeight = bannerExpanded ? 477 : 184
        const step = bannerExpanded ? -1 : 1

        const animateBannerHeight = () => {
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
        }

        interval = setInterval(animateBannerHeight, 5)
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [bannerExpanded])

    const toggleBanner = () => {
        setBannerExpanded(!bannerExpanded)
    }

    if (!isOpen) {
        return null
    }

    if (loading) {
        return (
            <div className={styles.overlay} onClick={onClose}>
                <div
                    className={styles.modalContainer}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={styles.loading}>Загрузка профиля...</div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className={styles.overlay} onClick={onClose}>
                <div
                    className={styles.modalContainer}
                    onClick={(e) => e.stopPropagation()}
                >
                    <p>Ошибка: {error?.message || String(error)}</p>
                </div>
            </div>
        )
    }

    if (!user) {
        return (
            <div className={styles.overlay} onClick={onClose}>
                <div
                    className={styles.modalContainer}
                    onClick={(e) => e.stopPropagation()}
                >
                    <p>Пользователь не найден</p>
                </div>
            </div>
        )
    }

    const bannerUrl = `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
    const avatarUrl = `${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`

    const statusTooltip = getStatusTooltip(user)
    const statusColor = getStatusColor(user)

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div
                className={styles.modalContainer}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.modalContent}>
                    {}
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
                                bannerExpanded
                                    ? 'Свернуть баннер'
                                    : 'Развернуть баннер'
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
                    </div>

                    {}
                    <div className={styles.userInfo}>
                        <div className={styles.userHeader}>
                            <div className={styles.userContainerLeft}>
                                {}
                                <div className={styles.userImage}>
                                    <img
                                        className={styles.avatarWrapper}
                                        src={avatarUrl}
                                        alt="Avatar"
                                        onError={(e) => {
                                            ;(
                                                e.currentTarget as HTMLImageElement
                                            ).src =
                                                './static/assets/images/undef.png'
                                        }}
                                        width="100"
                                        height="100"
                                    />
                                    {}
                                    <TooltipButton
                                        tooltipText={statusTooltip}
                                        side="top"
                                        className={styles.statusIndicator}
                                        style={{ backgroundColor: statusColor }}
                                    >
                                        {}
                                        <></>
                                    </TooltipButton>
                                </div>

                                <div className={styles.userInfoText}>
                                    <div className={styles.userName}>
                                        {user.nickname || 'Без никнейма'}
                                        <div className={styles.userBadges}>
                                            {Array.isArray(user.badges) &&
                                                user.badges
                                                    .sort(
                                                        (a, b) => b.level - a.level,
                                                    )
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

                            {}
                            <TooltipButton
                                className={styles.rightContainer}
                                tooltipText="Скоро"
                                side="top"
                            >
                                <Button disabled className={styles.defaultButton}>
                                    Добавить в друзья
                                </Button>
                                <Button disabled className={styles.miniButton}>
                                    <MdMoreHoriz size={20} />
                                </Button>
                            </TooltipButton>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default UserProfileModal
