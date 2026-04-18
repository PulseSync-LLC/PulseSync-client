import React from 'react'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/ModChangelogShimmer.module.scss'

export default function ModChangelogShimmer() {
    return (
        <div className={styles.shell}>
            {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className={styles.item}>
                    <div className={styles.versionInfo}>
                        <div className={styles.versionBadge} />
                        <div className={styles.date} />
                    </div>
                    <div className={styles.content}>
                        {[2, 3].map((bulletCount, sectionIndex) => (
                            <div key={sectionIndex} className={styles.section}>
                                <div className={styles.sectionTitle} />
                                <div className={styles.bullets}>
                                    {Array.from({ length: bulletCount }, (_, bulletIndex) => (
                                        <div key={bulletIndex} className={styles.bulletRow}>
                                            <div className={styles.bulletDot} />
                                            <div
                                                className={
                                                    bulletIndex === bulletCount - 1 ? styles.bulletLineShort : styles.bulletLine
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
