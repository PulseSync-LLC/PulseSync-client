import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as styles from './userCard.module.scss'
import config from '../../api/config'
import TooltipButton from '../tooltip_button'
import { getStatusColor, getStatus } from '../../utils/userStatus'
import UserInterface from '../../api/interfaces/user.interface'

interface UserCardProps {
    user: Partial<UserInterface>
    onClick: (username: string) => void
    placeholder?: boolean
}

const useIntersectionObserver = (ref: React.RefObject<HTMLElement>, options?: IntersectionObserverInit) => {
    const [isIntersecting, setIsIntersecting] = useState(false)

    useEffect(() => {
        if (!ref.current) return
        const observer = new IntersectionObserver(([entry]) => {
            setIsIntersecting(entry.isIntersecting)
        }, options)
        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [ref, options])

    return isIntersecting
}

const getMediaUrl = ({ type, hash, ext, hovered }: { type: 'avatar' | 'banner'; hash?: string; ext?: string; hovered: boolean }) => {
    if (!hash) {
        return type === 'avatar'
            ? './static/assets/images/undef.png'
            : 'linear-gradient(90deg, rgba(26, 31, 45, 0.67) 0%, rgba(26, 31, 45, 0.56) 100%) 100%), url(./static/assets/images/undef.png)'
    }

    const base = `${config.S3_URL}/${type}s/${hash}`
    if (ext === 'gif') {
        const preview = hovered ? `${base}.gif` : `${base}_preview.webp`
        return type === 'avatar' ? preview : `linear-gradient(90deg, rgba(26, 31, 45, 0.67) 0%, rgba(26, 31, 45, 0.56) 100%), url(${preview})`
    }

    return type === 'avatar'
        ? `${config.S3_URL}/avatars/${hash}.${ext}`
        : `linear-gradient(90deg, rgba(26, 31, 45, 0.67) 0%, rgba(26, 31, 45, 0.56) 100%), url(${config.S3_URL}/banners/${hash}.${ext})`
}

const isInactive = (lastOnline?: number) => {
    if (!lastOnline) return false
    const lastOnlineDate = new Date(lastOnline)
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
    return lastOnlineDate < oneWeekAgo
}

const UserCard: React.FC<UserCardProps> = ({ user, onClick, placeholder = false }) => {
    if (placeholder) {
        return <div className={styles.userCardSkeleton} style={{ height: '100px', width: '100%' }} aria-hidden="true" />
    }

    const containerRef = useRef<HTMLDivElement>(null)
    const isVisible = useIntersectionObserver(containerRef, { threshold: 0.1 })

    const [isHovered, setIsHovered] = useState(false)
    const [isStatusVisible] = useState(true)

    const statusInfo = getStatus(user as UserInterface)
    const statusColor = getStatusColor(user as UserInterface)
    const statusColorDark = getStatusColor(user as UserInterface, true)

    const sortedBadges = useMemo(() => (user as UserInterface).badges?.slice().sort((a, b) => b.level - a.level) || [], [user?.badges])

    const bannerBackground = useMemo(
        () =>
            getMediaUrl({
                type: 'banner',
                hash: (user as UserInterface).bannerHash,
                ext: (user as UserInterface).bannerType,
                hovered: isHovered,
            }),
        [(user as UserInterface).bannerHash, (user as UserInterface).bannerType, isHovered],
    )

    const avatarUrl = useMemo(
        () =>
            getMediaUrl({
                type: 'avatar',
                hash: (user as UserInterface).avatarHash,
                ext: (user as UserInterface).avatarType,
                hovered: isHovered,
            }),
        [(user as UserInterface).avatarHash, (user as UserInterface).avatarType, isHovered],
    )

    if (!isVisible) {
        return <div ref={containerRef} style={{ height: '100px', width: '100%' }} />
    }

    return (
        <div
            ref={containerRef}
            className={styles.container}
            style={
                {
                    animation: 'fadeIn 0.4s ease forwards',
                    height: '100px',
                    width: '100%',
                    '--statusColorProfile': statusColor,
                    '--statusColorDark': statusColorDark,
                    opacity: isInactive(Number((user as UserInterface).lastOnline)) ? 0.5 : 1,
                    backgroundImage: bannerBackground,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center center',
                    backgroundSize: 'cover',
                } as React.CSSProperties
            }
        >
            <button
                className={`${styles.userCard} ${(user as UserInterface).status === 'offline' ? styles.userCardOffline : ''}`}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={() => onClick((user as UserInterface).username)}
            >
                <img
                    key={avatarUrl}
                    loading="lazy"
                    className={styles.userAvatar}
                    src={avatarUrl}
                    alt={(user as UserInterface).username}
                    onError={e => {
                        ;(e.currentTarget as HTMLImageElement).src = './static/assets/images/undef.png'
                    }}
                />

                <div className={styles.userInfoCompact}>
                    <div className={styles.infoTop}>
                        <div className={styles.nickname}>{(user as UserInterface).nickname}</div>
                        <div className={styles.badges}>
                            {sortedBadges.map(_badge => (
                                <TooltipButton key={`${_badge.type}-${_badge.level}`} tooltipText={_badge.name} side="bottom">
                                    <div className={styles.badge}>
                                        <img src={`static/assets/badges/${_badge.type}.svg`} alt={_badge.name} className={styles.badgeIcon} />
                                    </div>
                                </TooltipButton>
                            ))}
                        </div>
                    </div>

                    <div className={styles.infoBottom}>
                        <TooltipButton tooltipText={statusInfo.detail} tipEnabled={statusInfo.detail !== null} side="bottom">
                            <div
                                className={`${styles.statusText} ${isStatusVisible ? styles.fadeIn : styles.fadeOut}`}
                                style={{
                                    color: statusColorDark,
                                }}
                            >
                                {statusInfo.text}
                            </div>
                        </TooltipButton>

                        <div
                            className={styles.levelBadge}
                            style={{
                                color: (user as UserInterface).status === 'offline' ? statusColorDark : statusColor,
                            }}
                        >
                            {user.levelInfo?.currentLevel || 0} Lv
                        </div>
                    </div>
                </div>
            </button>
        </div>
    )
}

export default UserCard
