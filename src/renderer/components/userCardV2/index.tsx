import React, { useState, useEffect, useRef, useMemo } from 'react'
import cn from 'clsx'
import * as styles from './userCard.module.scss'
import TooltipButton from '../tooltip_button'
import { getStatusColor } from '../../utils/userStatus'
import UserInterface from '../../api/interfaces/user.interface'
import { MdNightsStay, MdPower, MdPowerOff } from 'react-icons/md'
import LevelBadge from '../LevelBadge'
import { staticAsset } from '../../utils/staticAssets'
import { getEffectiveLevelInfo } from '../../utils/levelInfo'
import { useTranslation } from 'react-i18next'
import { Avatar, Banner } from '../PSUI/Image'

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
            rootMargin: '50%',
        })
        obs.observe(ref.current)
        return () => obs.disconnect()
    }, [ref, options])
    return isIntersecting
}

const isInactive = (lastOnline?: number) => {
    if (!lastOnline) return false
    const date = new Date(lastOnline)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 31)
    return date < weekAgo
}

const UserCardV2: React.FC<UserCardProps> = ({ user, onClick }) => {
    const { t } = useTranslation()
    const containerRef = useRef<HTMLDivElement>(null)
    const isVisible = useIntersectionObserver(containerRef, { threshold: 0.1 })
    const [isHovered, setIsHovered] = useState(false)

    const statusColor = getStatusColor(user as UserInterface)
    const statusColorDark = getStatusColor(user as UserInterface, true)
    const typedUser = user as UserInterface
    const levelInfo = useMemo(() => getEffectiveLevelInfo(typedUser), [typedUser.levelInfoV2])

    const sortedBadges = useMemo(() => (user as UserInterface).badges?.slice().sort((a, b) => b.level - a.level) || [], [user.badges])

    return (
        <div ref={containerRef} style={{ width: '100%', height: '150px' }} aria-hidden={!isVisible}>
            {isVisible ? (
                <div
                    className={cn(styles.container, styles.visible)}
                    onClick={() => onClick(user.username!)}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    style={
                        {
                            '--statusColorProfile': statusColor,
                            '--statusColorDark': statusColorDark,
                        } as React.CSSProperties
                    }
                >
                    <div className={styles.topSection}>
                        <Banner
                            className={styles.bannerImage}
                            hash={typedUser.bannerHash}
                            ext={typedUser.bannerType}
                            sizes="360px"
                            alt=""
                            allowAnimate={isHovered}
                        />
                        <div className={styles.bannerGradient} />
                        <Avatar
                            loading="lazy"
                            className={styles.userAvatar}
                            hash={typedUser.avatarHash}
                            ext={typedUser.avatarType}
                            sizes="60px"
                            alt={user.username}
                            allowAnimate={isHovered}
                        />
                        <div className={styles.userInfo}>
                            <div className={styles.badges}>
                                <TooltipButton
                                    tooltipText={t('profile.level', { level: levelInfo.currentLevel })}
                                    side="bottom"
                                >
                                    <LevelBadge level={levelInfo.currentLevel} />
                                </TooltipButton>
                                {sortedBadges.map(b => (
                                    <TooltipButton key={`${b.type}-${b.level}`} tooltipText={b.name} side="bottom">
                                        <div className={styles.badge}>
                                            <img src={staticAsset(`assets/badges/${b.type}.svg`)} alt={b.name} className={styles.badgeIcon} />
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
                            {isInactive(Number(user.lastOnline))
                                ? t('userStatus.inactive')
                                : typedUser.status === 'online'
                                  ? t('userStatus.online')
                                  : t('userStatus.offline')}
                        </div>
                        {isInactive(Number(user.lastOnline)) ? (
                            <MdNightsStay className={styles.statusIcon} style={{ color: '#9885A9' }} />
                        ) : typedUser.status === 'online' ? (
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

export default React.memo(UserCardV2)
