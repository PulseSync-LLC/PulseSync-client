import React from 'react'
import TooltipButton from '../../../tooltip_button'
import LevelBadge from '../../../LevelBadge'
import * as styles from '../../userProfileModal.module.scss'
import { staticAsset } from '../../../../utils/staticAssets'
import { useTranslation } from 'react-i18next'
import Image from '../../../PSUI/Image'

const fallbackAvatar = staticAsset('assets/images/undef.png')

interface ProfileHeaderProps {
    userProfile: any
    user: any
    children?: React.ReactNode
}

const ProfileHeader: React.FC<ProfileHeaderProps> = ({ userProfile, user, children }) => {
    const { t, i18n } = useTranslation()
    return (
        <div className={styles.bannerBackground}>
            <Image
                className={styles.bannerImage}
                type="banner"
                hash={userProfile.bannerHash}
                ext={userProfile.bannerType}
                sizes="(max-width: 1024px) 100vw, 1010px"
                alt=""
                fallbackHash="default_banner"
                fallbackExt="webp"
            />
            <div className={styles.bannerGradient} />
            <div className={styles.userImage}>
                <Image
                    className={styles.avatarWrapper}
                    type="avatar"
                    hash={userProfile.avatarHash}
                    ext={userProfile.avatarType}
                    sizes="84px"
                    alt="Avatar"
                    width="84"
                    height="84"
                    fallbackSrc={fallbackAvatar}
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
