import React, { useEffect, useMemo, useRef, useState } from 'react'
import TooltipButton from '../../../tooltip_button'
import LevelBadge from '../../../LevelBadge'
import * as styles from '../../userProfileModal.module.scss'
import { staticAsset } from '../../../../utils/staticAssets'
import { useTranslation } from 'react-i18next'
import { Avatar, Banner } from '../../../PSUI/Image'
import * as scrollbarStyles from '../../../PSUI/Scrollbar/Scrollbar.module.scss'
import { getEffectiveLevelInfo } from '../../../../utils/levelInfo'

interface ProfileHeaderProps {
    userProfile: any
    user: any
    children?: React.ReactNode
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ userProfile, user, children }) => {
    const { t, i18n } = useTranslation()
    const headerRef = useRef<HTMLDivElement>(null)
    const [allowAnimate, setAllowAnimate] = useState(true)
    const levelInfo = useMemo(() => getEffectiveLevelInfo(userProfile), [userProfile?.levelInfoV2])

    useEffect(() => {
        const threshold = 380
        const header = headerRef.current
        if (!header) return

        const getScrollContainer = () => {
            let current: HTMLElement | null = header.parentElement
            while (current) {
                if (current.classList.contains(scrollbarStyles.scrollContent)) {
                    return current
                }
                current = current.parentElement
            }

            return null
        }

        const scrollContainer = getScrollContainer()
        const useWindowScroll = !scrollContainer

        const updateAllowAnimate = () => {
            const scrollTop = useWindowScroll
                ? window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
                : scrollContainer.scrollTop

            setAllowAnimate(scrollTop < threshold)
        }

        updateAllowAnimate()

        if (useWindowScroll) {
            window.addEventListener('scroll', updateAllowAnimate, { passive: true })
            return () => {
                window.removeEventListener('scroll', updateAllowAnimate)
            }
        }

        scrollContainer.addEventListener('scroll', updateAllowAnimate, { passive: true })
        return () => {
            scrollContainer.removeEventListener('scroll', updateAllowAnimate)
        }
    }, [])

    return (
        <div className={styles.bannerBackground} ref={headerRef}>
            <Banner
                className={styles.bannerImage}
                hash={userProfile.bannerHash}
                ext={userProfile.bannerType}
                sizes="(max-width: 1024px) 100vw, 1010px"
                alt=""
                allowAnimate={allowAnimate}
            />
            <div className={styles.bannerGradient} />
            <div className={styles.userImage}>
                <Avatar
                    className={styles.avatarWrapper}
                    hash={userProfile.avatarHash}
                    ext={userProfile.avatarType}
                    sizes="84px"
                    alt="Avatar"
                    width="84"
                    height="84"
                    allowAnimate={allowAnimate}
                />
                <div className={styles.userInfo}>
                    <div className={styles.dateCreate}>
                        <div className={styles.dateCreate}>
                            {new Date(userProfile.createdAt) <= new Date(2025, 0, 17) ? (
                                <TooltipButton
                                    styleComponent={{
                                        padding: 0,
                                        background: 'transparent',
                                    }}
                                    tooltipText={
                                        <div className={styles.dateCreateTooltip}>
                                            {new Date(userProfile.createdAt).toLocaleString(i18n.language, {
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
                                    {t('profile.sinceBeginning')}
                                </TooltipButton>
                            ) : (
                                <TooltipButton
                                    styleComponent={{
                                        padding: 0,
                                        background: 'transparent',
                                    }}
                                    tooltipText={
                                        <div className={styles.dateCreateTooltip}>
                                            {new Date(userProfile.createdAt).toLocaleString(i18n.language, {
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
                                    {t('profile.registrationDate')}{' '}
                                    {new Date(userProfile.createdAt).toLocaleDateString(i18n.language, {
                                        month: 'long',
                                        year: 'numeric',
                                    })}
                                </TooltipButton>
                            )}
                        </div>
                    </div>
                    <div className={styles.userName}>
                        {userProfile.nickname || t('profile.noNickname')}
                        <div className={styles.userBadges}>
                            <TooltipButton tooltipText={t('profile.level', { level: levelInfo.currentLevel })} side="top">
                                <LevelBadge level={levelInfo.currentLevel} />
                            </TooltipButton>
                            {Array.isArray(userProfile.badges) &&
                                userProfile.badges
                                    .sort((a: any, b: any) => b.level - a.level)
                                    .map((badge: any) => (
                                        <TooltipButton tooltipText={badge.name} side="top" className={styles.badge} key={badge.uuid}>
                                            <img src={staticAsset(`assets/badges/${badge.type}.svg`)} alt={badge.type} />
                                        </TooltipButton>
                                    ))}
                        </div>
                    </div>
                    <div className={styles.userUsername}>@{userProfile.username}</div>
                </div>
            </div>
            <div className={styles.userButtons}>{children}</div>
        </div>
    )
}

export default ProfileHeader
