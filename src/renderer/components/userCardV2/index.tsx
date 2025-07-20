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
        const obs = new IntersectionObserver(([entry]) => setIsIntersecting(entry.isIntersecting), {
            ...options,
            rootMargin: '50%', // Расширяем зону видимости на 50% высоты экрана
        })
        obs.observe(ref.current)
        return () => obs.disconnect()
    }, [ref, options])
    return isIntersecting
}

const getMediaUrl = ({ type, hash, ext, hovered }: { type: 'avatar' | 'banner'; hash?: string; ext?: string; hovered: boolean }) => {
    if (!hash) {
        return type === 'avatar'
            ? './static/assets/images/undef.png'
            : `linear-gradient(0deg, #2C303F 0%, rgba(55,60,80,0.3) 100%), url(${config.S3_URL}/banners/default_banner.webp)`
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
    weekAgo.setDate(weekAgo.getDate() - 31)
    return date < weekAgo
}

const UserCardV2: React.FC<UserCardProps> = ({ user, onClick }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const isVisible = useIntersectionObserver(containerRef, { threshold: 0.1 })
    const [isHovered, setIsHovered] = useState(false)
    const [bannerUrl, setBannerUrl] = useState(
        getMediaUrl({
            type: 'banner',
            hash: (user as UserInterface).bannerHash,
            ext: (user as UserInterface).bannerType,
            hovered: false,
        })
    )

    useEffect(() => {
        const img = new Image()
        const bannerSrc = `${config.S3_URL}/banners/${(user as UserInterface).bannerHash}.${(user as UserInterface).bannerType}`
        img.src = bannerSrc
        img.onload = () => {
            setBannerUrl(
                getMediaUrl({
                    type: 'banner',
                    hash: (user as UserInterface).bannerHash,
                    ext: (user as UserInterface).bannerType,
                    hovered: isHovered,
                })
            )
        }
        img.onerror = () => {
            setBannerUrl(
                `linear-gradient(0deg, #2C303F 0%, rgba(55,60,80,0.3) 100%), url(${config.S3_URL}/banners/default_banner.webp)`
            )
        }
    }, [(user as UserInterface).bannerHash, (user as UserInterface).bannerType, isHovered])

    const statusInfo = getStatus(user as UserInterface)
    const statusColor = getStatusColor(user as UserInterface)
    const statusColorDark = getStatusColor(user as UserInterface, true)

    const sortedBadges = useMemo(() => (user as UserInterface).badges?.slice().sort((a, b) => b.level - a.level) || [], [user.badges])

    const avatarUrl = useMemo(
        () =>
            getMediaUrl({
                type: 'avatar',
                hash: (user as UserInterface).avatarHash,
                ext: (user as UserInterface).avatarType,
                hovered: isHovered,
            }),
        [(user as UserInterface).avatarHash, (user as UserInterface).avatarType, isHovered]
    )

    return (
        <div ref={containerRef} style={{ width: '100%', height: '150px' }} aria-hidden={!isVisible}>
            {isVisible ? (
                <div
                    className={`${styles.container} ${styles.visible}`}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    onClick={() => onClick(user.username!)}
                    style={
                        {
                            '--statusColorProfile': statusColor,
                            '--statusColorDark': statusColorDark,
                        } as React.CSSProperties
                    }
                >
                    <div
                        className={styles.topSection}
                        style={{
                            background: bannerUrl,
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
            ) : null}
        </div>
    )
}

export default UserCardV2