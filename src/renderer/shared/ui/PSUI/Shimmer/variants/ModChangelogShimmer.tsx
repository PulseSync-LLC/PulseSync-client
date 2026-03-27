import React from 'react'
import Line from '@shared/ui/PSUI/Shimmer/ui/Line'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/ModChangelogShimmer.module.scss'

export default function ModChangelogShimmer() {
    return (
        <div className={styles.shell}>
            {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.item}>
                    <div className={styles.meta}>
                        <div className={styles.version} />
                        <div className={styles.date} />
                    </div>
                    <div className={styles.content}>
                        <Line wide />
                        <Line />
                        <Line short />
                    </div>
                </div>
            ))}
        </div>
    )
}
