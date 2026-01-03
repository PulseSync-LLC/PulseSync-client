import React from 'react'
import TooltipButton from '../../../tooltip_button'
import LevelBadge from '../../../LevelBadge'
import * as styles from '../../userProfileModal.module.scss'
import config from '../../../../api/web_config'
import { staticAsset } from '../../../../utils/staticAssets'

const fallbackAvatar = staticAsset('assets/images/undef.png')

interface ProfileHeaderProps {
    userProfile: any
    user: any
    children?: React.ReactNode
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ userProfile, user, children }) => {
    const bannerUrl = `${config.S3_URL}/banners/${userProfile.bannerHash}.${userProfile.bannerType}`
    const avatarUrl = `${config.S3_URL}/avatars/${userProfile.avatarHash}.${userProfile.avatarType}`

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
                    className={styles.avatarWrapper}
                    src={avatarUrl}
                    alt="Avatar"
                    onError={e => {
                        ;(e.currentTarget as HTMLImageElement).src = fallbackAvatar
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
                                            {new Date(userProfile.createdAt).toLocaleString('ru-RU', {
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
                                    Здесь с самого начала
                                </TooltipButton>
                            ) : (
                                <TooltipButton
                                    styleComponent={{
                                        padding: 0,
                                        background: 'transparent',
                                    }}
                                    tooltipText={
                                        <div className={styles.dateCreateTooltip}>
                                            {new Date(userProfile.createdAt).toLocaleString('ru-RU', {
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
                                    Дата регистрации:{' '}
                                    {new Date(userProfile.createdAt).toLocaleDateString('ru-RU', {
                                        month: 'long',
                                        year: 'numeric',
                                    })}
                                </TooltipButton>
                            )}
                        </div>
                    </div>
                    <div className={styles.userName}>
                        {userProfile.nickname || 'Без никнейма'}
                        <div className={styles.userBadges}>
                            <TooltipButton tooltipText={`Уровень ${userProfile.levelInfo.currentLevel}`} side="top">
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
