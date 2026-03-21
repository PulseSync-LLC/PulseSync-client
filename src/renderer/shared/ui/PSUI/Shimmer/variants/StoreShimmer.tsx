import React from 'react'
import Line from '@shared/ui/PSUI/Shimmer/ui/Line'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/StoreShimmer.module.scss'

export default function StoreShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.grid}>
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className={styles.card}>
                        <div className={styles.badges}>
                            <div className={styles.badge} />
                            <div className={styles.badgeSmall} />
                        </div>

                        <div className={styles.content}>
                            <div className={styles.titleRow}>
                                <Line wide />
                                <div className={styles.version} />
                            </div>

                            <div className={styles.main}>
                                <div className={styles.icon} />

                                <div className={styles.text}>
                                    <Line />
                                    <Line short />
                                    <div className={styles.authors}>
                                        <Line wide />
                                        <Line short />
                                    </div>
                                    <Line short />
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
