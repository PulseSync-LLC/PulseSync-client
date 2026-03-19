import React, { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'

import UserInterface from '@entities/user/model/user.interface'
import { Avatar, Banner } from '@shared/ui/PSUI/Image'
import TooltipButton from '@shared/ui/tooltip_button'
import { staticAsset } from '@shared/lib/staticAssets'
import * as styles from '@widgets/layout/header.module.scss'

type Props = {
    avatarInputRef: React.RefObject<HTMLInputElement | null>
    avatarProgress: number
    bannerInputRef: React.RefObject<HTMLInputElement | null>
    bannerProgress: number
    isOpen: boolean
    logout: () => void
    onClose: () => void
    t: (key: string, options?: Record<string, any>) => string
    user: UserInterface
}

export default function UserMenuCard({ avatarInputRef, avatarProgress, bannerInputRef, bannerProgress, isOpen, logout, onClose, t, user }: Props) {
    const nav = useNavigate()

    return (
        <motion.div
            className={styles.user_menu}
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
        >
            <div className={styles.user_info}>
                <div className={styles.user_banner}>
                    <Banner className={styles.banner_image} hash={user.bannerHash} ext={user.bannerType} sizes="390px" alt="" allowAnimate={isOpen} />
                    <div className={styles.banner_gradient} />
                    <motion.div
                        className={styles.banner_overlay}
                        initial={{ width: '0%' }}
                        animate={{ width: bannerProgress !== -1 ? `${bannerProgress}%` : '0%' }}
                        transition={{ duration: 0.3, ease: 'linear' }}
                    >
                        <div className={styles.banner_loader} style={{ '--progress': `${bannerProgress}%` } as CSSProperties} />
                    </motion.div>
                    <div className={styles.hoverUpload} onClick={() => bannerInputRef.current!.showPicker()}>
                        {t('header.uploadBanner')}
                    </div>
                    <div className={styles.badges_container}>
                        {user.badges.length > 0 &&
                            user.badges
                                .sort((a, b) => b.level - a.level)
                                .map(badge => (
                                    <TooltipButton tooltipText={badge.name} side="bottom" key={badge.type}>
                                        <div className={styles.badge}>
                                            <img src={staticAsset(`assets/badges/${badge.type}.svg`)} alt={badge.type} />
                                        </div>
                                    </TooltipButton>
                                ))}
                    </div>
                </div>
                <div className={styles.user_avatar}>
                    <Avatar
                        className={styles.avatar}
                        hash={user.avatarHash}
                        ext={user.avatarType}
                        sizes="85px"
                        alt="card_avatar"
                        allowAnimate={isOpen}
                    />
                    <motion.div
                        className={styles.overlay}
                        initial={{ opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'linear' }}
                        animate={{ opacity: avatarProgress !== -1 ? `${avatarProgress}` : '0' }}
                    >
                        <div className={styles.loader} style={{ '--progress': `${avatarProgress}%` } as CSSProperties} />
                    </motion.div>
                    <div className={styles.hoverUpload} onClick={() => avatarInputRef.current!.showPicker()}>
                        {t('header.uploadAvatar')}
                    </div>
                    <div className={styles.status}>
                        <div className={styles.dot}></div>
                    </div>
                </div>
                <div className={styles.user_details}>
                    <div className={styles.user_info}>
                        <div
                            onClick={() => {
                                nav(`/profile/${encodeURIComponent(user.username)}`)
                                onClose()
                            }}
                            key={user.username}
                            className={styles.username}
                        >
                            {user.nickname}
                        </div>
                        <div className={styles.usertag}>@{user.username}</div>
                    </div>
                </div>
            </div>
            <div className={styles.user_menu_buttons}>
                <button
                    onClick={() => {
                        nav(`/profile/${encodeURIComponent(user.username)}`)
                        onClose()
                    }}
                    key={user.id}
                    className={styles.menu_button}
                >
                    {t('header.myProfile')}
                </button>
                <button className={styles.menu_button} disabled>
                    {t('header.friends')}
                </button>
                <button className={styles.menu_button} disabled>
                    {t('header.settings')}
                </button>
                <button className={styles.menu_button} onClick={logout}>
                    {t('header.logout')}
                </button>
            </div>
        </motion.div>
    )
}
