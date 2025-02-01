// src/renderer/components/userCard/index.tsx
import React, { useState, useEffect, useRef } from 'react'
import * as styles from './userCard.module.scss'
import config from '../../api/config'
import Button from '../button'
import TooltipButton from '../tooltip_button'
import { getStatusColor, getStatus } from '../../utils/userStatus'
import UserInterface from '../../api/interfaces/user.interface'
import { MdMoreHoriz, MdPersonAddAlt1 } from 'react-icons/md'

interface UserCardProps {
    user: UserInterface
    onClick: (username: string) => void
}

const UserCard: React.FC<UserCardProps> = ({ user, onClick }) => {
    const statusColor = getStatusColor(user)
    const statusColorDark = getStatusColor(user, true)
    const statusUser = getStatus(user)

    const isInactive = (): boolean => {
        if (!user.lastOnline) return false
        const lastOnlineDate = new Date(Number(user.lastOnline))
        const oneWeekAgo = new Date()
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
        return lastOnlineDate < oneWeekAgo
    }

    const avatarExt = user.avatarType
    const bannerExt = user.bannerType

    const containerRef = useRef<HTMLDivElement>(null)
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    setIsVisible(entry.isIntersecting)
                })
            },
            { threshold: 0.1 }
        )

        if (containerRef.current) {
            observer.observe(containerRef.current)
        }

        return () => observer.disconnect()
    }, [])

    const background = user.bannerHash
        ? `linear-gradient(90deg, rgba(8, 14, 34, 0.8) 0%, rgba(8, 14, 34, 0.7) 100%), url(${config.S3_URL}/banners/${user.bannerHash}.${bannerExt}) no-repeat center center`
        : `linear-gradient(90deg, rgba(8, 14, 34, 0.8) 0%, rgba(8, 14, 34, 0.7) 100%)`

    return (
        <div ref={containerRef} style={{ height: "126px", width: "-webkit-fill-available", position: "relative", display: "grid"}}>
            {isVisible ? (
                <button
                    className={styles.userCard}
                    onClick={() => onClick(user.username)}
                    style={
                        {
                            '--statusColor': statusColor,
                            '--statusColorDark': statusColorDark,
                            opacity: isInactive() ? 0.3 : 1,
                            background,
                            backgroundSize: 'cover',
                        } as React.CSSProperties
                    }
                >
                    <div className={styles.userCardContent}>
                        <div className={styles.userCardHeader}>
                            <img
                                loading="lazy"
                                className={styles.userAvatar}
                                src={`${config.S3_URL}/avatars/${user.avatarHash}.${avatarExt}`}
                                alt={user.username}
                                onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).src =
                                        './static/assets/images/undef.png'
                                }}
                            />
                            <div className={styles.userStatus}>
                                <div className={styles.userInfo}>
                                    <div className={styles.userNickname}>
                                        {user.nickname}
                                    </div>
                                    <div className={styles.userUsername}>
                                        @{user.username}
                                    </div>
                                </div>
                                <div className={styles.userBadges}>
                                    {user.badges.length > 0 &&
                                        user.badges
                                            .slice()
                                            .sort((a, b) => b.level - a.level)
                                            .map((_badge) => (
                                                <TooltipButton
                                                    key={`${_badge.type}-${_badge.level}`}
                                                    tooltipText={_badge.name}
                                                    side="bottom"
                                                >
                                                    <div
                                                        className={`${styles.badge} ${styles[`badgeLevel${_badge.level}`]}`}
                                                    >
                                                        <img
                                                            src={`static/assets/badges/${_badge.type}.svg`}
                                                            alt={_badge.name}
                                                        />
                                                    </div>
                                                </TooltipButton>
                                            ))}
                                </div>
                            </div>
                        </div>
                        <TooltipButton
                            className={styles.cardDetail}
                            tooltipText="Скоро"
                            side="left"
                        >
                            <Button disabled className={styles.cardDetailButton}>
                                <MdPersonAddAlt1 size={20} />
                            </Button>
                            <Button disabled className={styles.cardDetailButton}>
                                <MdMoreHoriz size={20} />
                            </Button>
                        </TooltipButton>
                    </div>
                    <div className={styles.userStatusInfo}>{statusUser}</div>
                </button>
            ) : null}
        </div>
    )
}

export default UserCard
