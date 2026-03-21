import React from 'react'
import Line from '@shared/ui/PSUI/Shimmer/ui/Line'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/UsersShimmer.module.scss'

export default function UsersShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.grid}>
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className={styles.card}>
                        <div className={styles.topSection}>
                            <div className={styles.banner} />
                            <div className={styles.bannerGradient} />
                            <div className={styles.avatar} />
                            <div className={styles.cardBody}>
                                <div className={styles.badgesRow}>
                                    <div className={styles.badge} />
                                    <div className={styles.badgeSmall} />
                                </div>
                                <Line wide />
                            </div>
                        </div>

                        <div className={styles.bottomSection}>
                            <div className={styles.statusLine} />
                            <div className={styles.statusIcon} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
