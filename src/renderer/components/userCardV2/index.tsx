// src/renderer/components/userCardV2/index.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react'
import * as styles from './userCard.module.scss'
import config from '../../api/config'
import TooltipButton from '../tooltip_button'
import { getStatusColor, getStatus } from '../../utils/userStatus'
import UserInterface from '../../api/interfaces/user.interface'
import { MdNightsStay, MdPower, MdPowerOff } from 'react-icons/md'
import LevelBadge from '../LevelBadge'

interface UserCardProps {
    user: Partial<UserInterface>
    onClick: (username: string) => void
}

const useIntersectionObserver = (ref: React.RefObject<HTMLElement>, options?: IntersectionObserverInit) => {
    const [isIntersecting, setIsIntersecting] = useState(false)
    useEffect(() => {
        if (!ref.current) return
        const obs = new IntersectionObserver(([e]) => setIsIntersecting(e.isIntersecting), options)
        obs.observe(ref.current)
        return () => obs.disconnect()
    }, [ref, options])
    return isIntersecting
}

const getMediaUrl = ({ type, hash, ext, hovered }: { type: 'avatar' | 'banner'; hash?: string; ext?: string; hovered: boolean }) => {
    if (!hash) {
        return type === 'avatar'
            ? './static/assets/images/undef.png'
            : 'linear-gradient(0deg, #2C303F 0%, rgba(55,60,80,0.3) 100%), url(./static/assets/images/undef.png)'
    }
    const base = `${config.S3_URL}/${type}s/${hash}`
    if (ext === 'gif') {
        const preview = hovered ? `${base}.gif` : `${base}_preview.webp`
        return type === 'avatar' ? preview : `linear-gradient(0deg, #2C303F 0%, rgba(55,60,80,0.3) 100%), url(${preview})`
    }
    return type === 'avatar'
        ? `${config.S3_URL}/avatars/${hash}.${ext}`
        : `linear-gradient(0deg, #2C303F 0%, rgba(55,60,80,0.3) 100%), url(${config.S3_URL}/banners/${hash}.${ext})`
}

const isInactive = (lastOnline?: number) => {
    if (!lastOnline) return false
    const date = new Date(lastOnline)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    return date < weekAgo
}

const UserCardV2: React.FC<UserCardProps> = ({ user, onClick }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const isVisible = useIntersectionObserver(containerRef, { threshold: 0.1 })
    const [showContent, setShowContent] = useState(false)
    const [isHovered, setIsHovered] = useState(false)

    // Как только попали в зону видимости — включаем контент
    useEffect(() => {
        if (isVisible) setShowContent(true)
    }, [isVisible])

    // === ВСЕ ХУКИ ВЫЗЫВАЕМ ВСЕГДА, ВНЕ ЗАВИСИМОСТИ ОТ showContent ===
    const statusInfo = getStatus(user as UserInterface)
    const statusColor = getStatusColor(user as UserInterface)
    const statusColorDark = getStatusColor(user as UserInterface, true)

    const sortedBadges = useMemo(() => (user as UserInterface).badges?.slice().sort((a, b) => b.level - a.level) || [], [user.badges])

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

    // === РЕНДЕРИМ ЛИБО skeleton, ЛИБО контент ===
    return (
        <div ref={containerRef} style={{ width: '100%', height: '150px' }}>
            {!showContent ? (
                <div className={styles.userCardSkeleton} aria-hidden="true" style={{ width: '100%', height: '150px' }} />
            ) : (
                <div
                    className={styles.container}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    onClick={() => onClick(user.username!)}
                    style={
                        {
                            animation: 'fadeIn 0.4s ease forwards',
                            '--statusColorProfile': statusColor,
                            '--statusColorDark': statusColorDark,
                        } as React.CSSProperties
                    }
                >
                    <div
                        className={styles.topSection}
                        style={{
                            background: bannerBackground,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'center center',
                            backgroundSize: 'cover',
                        }}
                    >
                        <img
                            key={avatarUrl}
                            loading="lazy"
                            className={styles.userAvatar}
                            src={avatarUrl}
                            alt={user.username}
                            onError={e => {
                                ;(e.currentTarget as HTMLImageElement).src = './static/assets/images/undef.png'
                            }}
                        />
                        <div className={styles.userInfo}>
                            <div className={styles.badges}>
                                <TooltipButton tooltipText={`Уровень ${(user as UserInterface).levelInfo.currentLevel}`} side="bottom">
                                    <LevelBadge level={(user as UserInterface).levelInfo.currentLevel} />
                                </TooltipButton>
                                {sortedBadges.map(b => (
                                    <TooltipButton key={`${b.type}-${b.level}`} tooltipText={b.name} side="bottom">
                                        <div className={styles.badge}>
                                            <img src={`static/assets/badges/${b.type}.svg`} alt={b.name} className={styles.badgeIcon} />
                                        </div>
                                    </TooltipButton>
                                ))}
                            </div>
                            <div className={styles.nickname}>{user.nickname}</div>
                        </div>
                    </div>
                    <div className={styles.bottomSection}>
                        <div
                            className={styles.statusText}
                            style={{
                                color: isInactive(Number(user.lastOnline)) ? '#9885A9' : 'var(--statusColorProfile)',
                            }}
                        >
                            {isInactive(Number(user.lastOnline)) ? 'Потеряшка' : (user as UserInterface).status === 'online' ? 'В сети' : 'Не в сети'}
                        </div>
                        {isInactive(Number(user.lastOnline)) ? (
                            <MdNightsStay className={styles.statusIcon} style={{ color: '#9885A9' }} />
                        ) : (user as UserInterface).status === 'online' ? (
                            <MdPower className={styles.statusIcon} />
                        ) : (
                            <MdPowerOff className={styles.statusIcon} />
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default UserCardV2
