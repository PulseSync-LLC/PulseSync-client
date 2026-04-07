import React from 'react'
import Line from '@shared/ui/PSUI/Shimmer/ui/Line'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/StoreShimmer.module.scss'

export default function StoreShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.grid}>
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className={styles.card}>
                        <div className={styles.headerRow}>
                            <div className={styles.badges}>
                                <div className={styles.badge} />
                                <div className={styles.badgeSmall} />
                            </div>

                            <div className={styles.headerMeta} />
                        </div>

                        <div className={styles.content}>
                            <div className={styles.titleRow}>
                                <div className={styles.title} />
                                <div className={styles.version} />
                            </div>

                            <div className={styles.main}>
                                <div className={styles.icon} />

                                <div className={styles.text}>
                                    <div className={styles.subtitle}>
                                        <Line wide />
                                        <Line short />
                                    </div>

                                    <div className={styles.meta}>
                                        <div className={styles.authorsLabel} />
                                        <div className={styles.authorsValue}>
                                            <Line wide />
                                        </div>
                                    </div>

                                    <div className={styles.downloads} />
                                </div>
                            </div>
                        </div>

                        <div className={styles.button} />
                    </div>
                ))}
            </div>
        </div>
    )
}
