import React from 'react'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/ProfileShimmer.module.scss'

export default function ProfileShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.statusBar}>
                <div className={styles.statusText} />
                <div className={styles.statusIcon} />
            </div>

            <div className={styles.banner}>
                <div className={styles.identity}>
                    <div className={styles.avatar} />
                    <div className={styles.identityText}>
                        <div className={styles.dateLine} />
                        <div className={styles.nameRow}>
                            <div className={styles.nameLine} />
                            <div className={styles.badgesRow}>
                                <div className={styles.badgeWide} />
                                <div className={styles.badgeSmall} />
                                <div className={styles.badgeSmall} />
                                <div className={styles.badgeSmall} />
                            </div>
                        </div>
                        <div className={styles.usernameLine} />
                    </div>
                </div>

                <div className={styles.buttons}>
                    <div className={styles.buttonFull} />
                </div>
            </div>

            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle} />
                    <div className={styles.sectionSubtitle} />
                </div>

                <div className={styles.progressCard}>
                    <div className={styles.progressHeader}>
                        <div className={styles.progressLabel} />
                        <div className={styles.progressLabelShort} />
                    </div>

                    <div className={styles.progressBar}>
                        <div className={styles.progressLevelLeft} />
                        <div className={styles.progressFill} />
                        <div className={styles.progressValue} />
                        <div className={styles.progressLevelRight} />
                    </div>
                </div>

                <div className={styles.achievementList}>
                    <div className={styles.achievementListTitle} />
                    {Array.from({ length: 3 }, (_, index) => (
                        <div key={index} className={styles.achievementRow}>
                            <div className={styles.achievementThumb} />
                            <div className={styles.achievementContent}>
                                <div className={styles.achievementTitle} />
                                <div className={styles.achievementSubtitle} />
                            </div>
                            <div className={styles.achievementMeta} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
