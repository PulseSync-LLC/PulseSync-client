import React, { useEffect, useMemo, useState } from 'react'
import TooltipButton from '../../../tooltip_button'
import LevelBadge from '../../../LevelBadge'
import * as styles from '../../userProfileModal.module.scss'
import { staticAsset } from '../../../../utils/staticAssets'
import { useTranslation } from 'react-i18next'
import { getAvatarMediaUrls, getBannerMediaUrls, loadFirstAvailableImage } from '../../../../utils/mediaVariants'

const fallbackAvatar = staticAsset('assets/images/undef.png')

interface ProfileHeaderProps {
    userProfile: any
    user: any
    children?: React.ReactNode
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ userProfile, user, children }) => {
    const { t, i18n } = useTranslation()
    const avatarMedia = useMemo(
        () => getAvatarMediaUrls({ hash: userProfile.avatarHash, ext: userProfile.avatarType, cssSize: 84 }),
        [userProfile.avatarHash, userProfile.avatarType],
    )
    const [avatarUrl, setAvatarUrl] = useState(avatarMedia?.variantUrl || fallbackAvatar)

    useEffect(() => {
        setAvatarUrl(avatarMedia?.variantUrl || fallbackAvatar)
    }, [avatarMedia?.variantUrl])

    const bannerMedia = useMemo(
        () => getBannerMediaUrls({ hash: userProfile.bannerHash, ext: userProfile.bannerType, cssSize: 1010 }),
        [userProfile.bannerHash, userProfile.bannerType],
    )
    const defaultBannerMedia = useMemo(() => getBannerMediaUrls({ hash: 'default_banner', ext: 'webp', cssSize: 1010 }), [])
    const [bannerUrl, setBannerUrl] = useState(bannerMedia.variantUrl)

    useEffect(() => {
        return loadFirstAvailableImage(
            [bannerMedia.variantUrl, bannerMedia.originalUrl, defaultBannerMedia.variantUrl, defaultBannerMedia.originalUrl],
            setBannerUrl,
            () => setBannerUrl(defaultBannerMedia.originalUrl),
        )
    }, [bannerMedia.originalUrl, bannerMedia.variantUrl, defaultBannerMedia.originalUrl, defaultBannerMedia.variantUrl])

    return (
        <div
            className={styles.bannerBackground}
            style={{
                background: `linear-gradient(180deg, rgba(41, 44, 54, 0) 0%, #292C36 100%), url(${bannerUrl})`,
                backgroundSize: 'cover',
            }}
        >
            <div className={styles.userImage}>
                <img
                    key={avatarUrl}
                    className={styles.avatarWrapper}
                    src={avatarUrl}
                    alt="Avatar"
                    onError={() => {
                        setAvatarUrl(prev => {
                            if (avatarMedia?.originalUrl && prev !== avatarMedia.originalUrl) {
                                return avatarMedia.originalUrl
                            }
                            return fallbackAvatar
                        })
                    }}
                    width="84"
                    height="84"
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
                            <TooltipButton tooltipText={t('profile.level', { level: userProfile.levelInfo.currentLevel })} side="top">
                                <LevelBadge level={userProfile.levelInfo.currentLevel} />
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
