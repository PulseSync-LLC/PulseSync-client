import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import * as styles from './userCard.module.scss'
import TooltipButton from '../tooltip_button'
import { getStatusColor } from '../../utils/userStatus'
import UserInterface from '../../api/interfaces/user.interface'
import { MdNightsStay, MdPower, MdPowerOff } from 'react-icons/md'
import LevelBadge from '../LevelBadge'
import { staticAsset } from '../../utils/staticAssets'
import { useTranslation } from 'react-i18next'
import { getAvatarMediaUrls, getBannerMediaUrls, loadFirstAvailableImage } from '../../utils/mediaVariants'

const fallbackAvatar = staticAsset('assets/images/undef.png')

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

    const bannerMedia = useMemo(
        () =>
            getBannerMediaUrls({
                hash: (user as UserInterface).bannerHash,
                ext: (user as UserInterface).bannerType,
                cssSize: 360,
            }),
        [(user as UserInterface).bannerHash, (user as UserInterface).bannerType],
    )
    const defaultBannerMedia = useMemo(() => getBannerMediaUrls({ hash: 'default_banner', ext: 'webp', cssSize: 360 }), [])
    const [bannerUrl, setBannerUrl] = useState(bannerMedia.variantUrl)

    useEffect(() => {
        return loadFirstAvailableImage(
            [bannerMedia.variantUrl, bannerMedia.originalUrl, defaultBannerMedia.variantUrl, defaultBannerMedia.originalUrl],
            setBannerUrl,
            () => setBannerUrl(defaultBannerMedia.originalUrl),
        )
    }, [bannerMedia.originalUrl, bannerMedia.variantUrl, defaultBannerMedia.originalUrl, defaultBannerMedia.variantUrl])

    const bannerBackground = useMemo(
        () => `linear-gradient(0deg, #2C303F 0%, rgba(55,60,80,0.3) 100%), url(${bannerUrl})`,
        [bannerUrl],
    )

    const avatarMedia = useMemo(
        () =>
            getAvatarMediaUrls({
                hash: (user as UserInterface).avatarHash,
                ext: (user as UserInterface).avatarType,
                cssSize: 60,
            }),
        [(user as UserInterface).avatarHash, (user as UserInterface).avatarType],
    )
    const [avatarUrl, setAvatarUrl] = useState(avatarMedia?.variantUrl || fallbackAvatar)

    useEffect(() => {
        setAvatarUrl(avatarMedia?.variantUrl || fallbackAvatar)
    }, [avatarMedia?.variantUrl])

    const handleAvatarError = useCallback(() => {
        setAvatarUrl(prev => {
            if (avatarMedia?.originalUrl && prev !== avatarMedia.originalUrl) {
                return avatarMedia.originalUrl
            }
            return fallbackAvatar
        })
    }, [avatarMedia?.originalUrl])

    const statusColor = getStatusColor(user as UserInterface)
    const statusColorDark = getStatusColor(user as UserInterface, true)

    const sortedBadges = useMemo(() => (user as UserInterface).badges?.slice().sort((a, b) => b.level - a.level) || [], [user.badges])

    return (
        <div ref={containerRef} style={{ width: '100%', height: '150px' }} aria-hidden={!isVisible}>
            {isVisible ? (
                <div
                    className={`${styles.container} ${styles.visible}`}
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
                            onError={handleAvatarError}
                        />
                        <div className={styles.userInfo}>
                            <div className={styles.badges}>
                                <TooltipButton
                                    tooltipText={t('profile.level', { level: (user as UserInterface).levelInfo.currentLevel })}
                                    side="bottom"
                                >
                                    <LevelBadge level={(user as UserInterface).levelInfo.currentLevel} />
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
                                : (user as UserInterface).status === 'online'
                                  ? t('userStatus.online')
                                  : t('userStatus.offline')}
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
