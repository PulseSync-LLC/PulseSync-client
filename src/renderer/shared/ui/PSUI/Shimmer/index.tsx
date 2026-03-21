import React from 'react'
import cn from 'clsx'
import * as styles from '@shared/ui/PSUI/Shimmer/Shimmer.module.scss'

export type ShimmerVariant = 'store' | 'users' | 'extension' | 'profile' | 'panel'

type ShimmerProps = {
    variant?: ShimmerVariant
    className?: string
}

const Line = ({ short = false, wide = false }: { short?: boolean; wide?: boolean }) => (
    <div className={cn(styles.shimmerLine, short && styles.shimmerLine_short, wide && styles.shimmerLine_wide)} />
)

function StoreShimmer() {
    return (
        <div className={styles.storeShell}>
            <div className={styles.storeGrid}>
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className={styles.storeCard}>
                        <div className={styles.storeBadges}>
                            <div className={styles.storeBadge} />
                            <div className={styles.storeBadgeSmall} />
                        </div>

                        <div className={styles.storeCardBody}>
                            <div className={styles.storeIcon} />

                            <div className={styles.storeMain}>
                                <div className={styles.storeTitleRow}>
                                    <Line wide />
                                    <div className={styles.storeVersion} />
                                </div>
                                <Line />
                                <Line short />
                                <div className={styles.storeAuthors}>
                                    <Line wide />
                                    <Line short />
                                </div>
                                <Line short />
                            </div>

                            <div className={styles.storeButton} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

function ExtensionShimmer() {
    return (
        <div className={styles.extensionShell}>
            <div className={styles.extensionHero} />

            <div className={styles.extensionMetaBar}>
                <div className={styles.extensionMetaGrid}>
                    {Array.from({ length: 5 }, (_, index) => (
                        <div key={index} className={styles.extensionMetaItem}>
                            <Line short />
                            <Line />
                        </div>
                    ))}
                </div>
                <div className={styles.extensionActions}>
                    <div className={styles.extensionActionWide} />
                    <div className={styles.extensionAction} />
                    <div className={styles.extensionAction} />
                </div>
            </div>

            <div className={styles.extensionTabs}>
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className={styles.extensionTab} />
                ))}
            </div>

            <div className={styles.extensionContent}>
                <div className={styles.extensionCodeBlock} />
                <div className={styles.extensionSectionTitle} />
                <div className={styles.extensionParagraph}>
                    <Line />
                    <Line />
                    <Line short />
                </div>
                <div className={styles.extensionCodeBlockLarge} />
            </div>
        </div>
    )
}

function ProfileShimmer() {
    return (
        <div className={styles.profileShell}>
            <div className={styles.profileStatusBar}>
                <div className={styles.profileStatusText} />
                <div className={styles.profileStatusIcon} />
            </div>
            <div className={styles.profileBanner}>
                <div className={styles.profileIdentity}>
                    <div className={styles.profileAvatar} />
                    <div className={styles.profileIdentityText}>
                        <div className={styles.profileDateLine} />
                        <div className={styles.profileNameRow}>
                            <div className={styles.profileNameLine} />
                            <div className={styles.profileBadgesRow}>
                                <div className={styles.profileBadgeWide} />
                                <div className={styles.profileBadgeSmall} />
                                <div className={styles.profileBadgeSmall} />
                                <div className={styles.profileBadgeSmall} />
                            </div>
                        </div>
                        <div className={styles.profileUsernameLine} />
                    </div>
                </div>
                <div className={styles.profileButtons}>
                    <div className={styles.profileButtonFull} />
                </div>
            </div>

            <div className={styles.profileSection}>
                <div className={styles.profileSectionHeader}>
                    <div className={styles.profileSectionTitle} />
                    <div className={styles.profileSectionSubtitle} />
                </div>
                <div className={styles.profileProgressCard}>
                    <div className={styles.profileProgressHeader}>
                        <div className={styles.profileProgressLabel} />
                        <div className={styles.profileProgressLabelShort} />
                    </div>
                    <div className={styles.profileProgressBar}>
                        <div className={styles.profileProgressLevelLeft} />
                        <div className={styles.profileProgressFill} />
                        <div className={styles.profileProgressValue} />
                        <div className={styles.profileProgressLevelRight} />
                    </div>
                </div>
                <div className={styles.profileAchievementList}>
                    <div className={styles.profileAchievementListTitle} />
                    {Array.from({ length: 3 }, (_, index) => (
                        <div key={index} className={styles.profileAchievementRow}>
                            <div className={styles.profileAchievementThumb} />
                            <div className={styles.profileAchievementContent}>
                                <div className={styles.profileAchievementTitle} />
                                <div className={styles.profileAchievementSubtitle} />
                            </div>
                            <div className={styles.profileAchievementMeta} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

function UsersShimmer() {
    return (
        <div className={styles.usersShell}>
            <div className={styles.usersGrid}>
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className={styles.userCard}>
                        <div className={styles.userTopSection}>
                            <div className={styles.userBanner} />
                            <div className={styles.userBannerGradient} />
                            <div className={styles.userAvatar} />
                            <div className={styles.userCardBody}>
                                <div className={styles.userBadgesRow}>
                                    <div className={styles.userBadge} />
                                    <div className={styles.userBadgeSmall} />
                                </div>
                                <Line wide />
                            </div>
                        </div>
                        <div className={styles.userBottomSection}>
                            <div className={styles.userStatusLine} />
                            <div className={styles.userStatusIcon} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

function PanelShimmer() {
    return (
        <div className={styles.panelShell}>
            <div className={styles.panelHeader} />
            {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.panelBlock}>
                    <Line />
                    <Line short />
                </div>
            ))}
        </div>
    )
}

export default function Shimmer({ variant = 'store', className }: ShimmerProps) {
    return (
        <div className={cn(styles.shimmer, styles[`shimmer_${variant}`], className)} aria-hidden="true">
            {variant === 'store' ? (
                <StoreShimmer />
            ) : variant === 'users' ? (
                <UsersShimmer />
            ) : variant === 'extension' ? (
                <ExtensionShimmer />
            ) : variant === 'profile' ? (
                <ProfileShimmer />
            ) : (
                <PanelShimmer />
            )}
        </div>
    )
}
