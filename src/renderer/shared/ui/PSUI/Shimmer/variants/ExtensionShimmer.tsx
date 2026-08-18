import React from 'react'

import Line from '@shared/ui/PSUI/Shimmer/ui/Line'

import * as styles from '@shared/ui/PSUI/Shimmer/variants/ExtensionShimmer.module.scss'

export default function ExtensionShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.summaryPane}>
                <div className={styles.banner} />

                <div className={styles.identityRow}>
                    <div className={styles.logo} />
                    <div className={styles.actions}>
                        <div className={styles.actionWide} />
                        <div className={styles.action} />
                    </div>
                </div>

                <div className={styles.copy}>
                    <div className={styles.title} />
                    <Line wide />
                    <Line short />
                </div>

                <div className={styles.meta}>
                    {Array.from({ length: 4 }, (_, index) => (
                        <div key={index} className={styles.metaItem}>
                            <Line short />
                            <Line />
                        </div>
                    ))}
                </div>

                <div className={styles.section}>
                    <div className={styles.sectionTitle} />
                    <div className={styles.chips}>
                        <div className={styles.chipWide} />
                        <div className={styles.chip} />
                    </div>
                </div>
            </div>

            <div className={styles.detailPane}>
                <div className={styles.tabs}>
                    {Array.from({ length: 4 }, (_, index) => (
                        <div key={index} className={styles.tab} />
                    ))}
                </div>

                <div className={styles.content}>
                    <div className={styles.contentTitle} />
                    <div className={styles.paragraph}>
                        <Line />
                        <Line />
                        <Line wide />
                    </div>
                    <div className={styles.codeBlock} />
                    <div className={styles.contentSubtitle} />
                    <div className={styles.paragraph}>
                        <Line />
                        <Line short />
                    </div>
                </div>
            </div>
        </div>
    )
}
