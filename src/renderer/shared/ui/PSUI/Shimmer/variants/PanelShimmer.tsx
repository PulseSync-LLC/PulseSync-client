import React from 'react'
import Line from '@shared/ui/PSUI/Shimmer/ui/Line'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/PanelShimmer.module.scss'

export default function PanelShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.header} />
            {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className={styles.block}>
                    <Line />
                    <Line short />
                </div>
            ))}
        </div>
    )
}
