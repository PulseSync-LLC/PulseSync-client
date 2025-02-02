import React, { useState, useEffect, useRef, useMemo } from 'react'
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

const useIntersectionObserver = (
    ref: React.RefObject<HTMLElement>,
    options?: IntersectionObserverInit,
) => {
    const [isIntersecting, setIsIntersecting] = useState(false)

    useEffect(() => {
        if (!ref.current) return

        const observer = new IntersectionObserver(([entry]) => {
            setIsIntersecting(entry.isIntersecting)
        }, options)

        observer.observe(ref.current)
        return () => {
            observer.disconnect()
        }
    }, [ref, options])

    return isIntersecting
}

const getMediaUrl = ({
    type,
    hash,
    ext,
    hovered,
}: {
    type: 'avatar' | 'banner'
    hash?: string
    ext?: string
    hovered: boolean
}) => {
    if (!hash) {
        return type === 'avatar'
            ? './static/assets/images/undef.png'
            : 'linear-gradient(90deg, rgba(8, 14, 34, 0.8) 0%, rgba(8, 14, 34, 0.7) 100%)'
    }

    if (ext === 'gif') {
        const baseUrl = `${config.S3_URL}/${type}s/${hash}`
        if (type === 'avatar') {
            return hovered ? `${baseUrl}.gif` : `${baseUrl}_preview.webp`
        } else {
            const bannerImage = hovered
                ? `${baseUrl}.gif`
                : `${baseUrl}_preview.webp`
            return `linear-gradient(90deg, rgba(8, 14, 34, 0.8) 0%, rgba(8, 14, 34, 0.7) 100%), url(${bannerImage}) no-repeat center center`
        }
    }

    if (type === 'avatar') {
        return `${config.S3_URL}/avatars/${hash}.${ext}`
    } else {
        const bannerImage = `${config.S3_URL}/banners/${hash}.${ext}`
        return `linear-gradient(90deg, rgba(8, 14, 34, 0.8) 0%, rgba(8, 14, 34, 0.7) 100%), url(${bannerImage}) no-repeat center center`
    }
}

const isInactive = (lastOnline?: number) => {
    if (!lastOnline) return false
    const lastOnlineDate = new Date(lastOnline)
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
    return lastOnlineDate < oneWeekAgo
}

const UserCard: React.FC<UserCardProps> = ({ user, onClick }) => {
    const statusColor = getStatusColor(user)
    const statusColorDark = getStatusColor(user, true)
    const statusUser = getStatus(user)

    const sortedBadges = useMemo(
        () => user.badges.slice().sort((a, b) => b.level - a.level),
        [user.badges],
    )

    const containerRef = useRef<HTMLDivElement>(null)
    const isVisible = useIntersectionObserver(containerRef, { threshold: 0.1 })

    const [isHovered, setIsHovered] = useState(false)

    const bannerBackground = useMemo(
        () =>
            getMediaUrl({
                type: 'banner',
                hash: user.bannerHash,
                ext: user.bannerType,
                hovered: isHovered,
            }),
        [user.bannerHash, user.bannerType, isHovered],
    )

    const avatarUrl = useMemo(
        () =>
            getMediaUrl({
                type: 'avatar',
                hash: user.avatarHash,
                ext: user.avatarType,
                hovered: isHovered,
            }),
        [user.avatarHash, user.avatarType, isHovered],
    )

    if (!isVisible) {
        return (
            <div
                ref={containerRef}
                style={{
                    height: '126px',
                    width: '-webkit-fill-available',
                    position: 'relative',
                    display: 'grid',
                }}
            />
        )
    }

    return (
        <div
            ref={containerRef}
            style={{
                height: '126px',
                width: '-webkit-fill-available',
                position: 'relative',
                display: 'grid',
            }}
        >
            <button
                className={styles.userCard}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={() => onClick(user.username)}
                style={
                    {
                        '--statusColor': statusColor,
                        '--statusColorDark': statusColorDark,
                        opacity: isInactive(Number(user.lastOnline)) ? 0.3 : 1,
                        background: bannerBackground,
                        backgroundSize: 'cover',
                    } as React.CSSProperties
                }
            >
                <div className={styles.userCardContent}>
                    <div className={styles.userCardHeader}>
                        <img
                            key={avatarUrl}
                            loading="lazy"
                            className={styles.userAvatar}
                            src={avatarUrl}
                            alt={user.username}
                            onError={(e) => {
                                ;(e.currentTarget as HTMLImageElement).src =
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
                                {sortedBadges.map((_badge) => (
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
        </div>
    )
}

export default UserCard
