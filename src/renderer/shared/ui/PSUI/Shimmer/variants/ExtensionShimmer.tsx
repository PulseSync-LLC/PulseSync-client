import React from 'react'
import Line from '@shared/ui/PSUI/Shimmer/ui/Line'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/ExtensionShimmer.module.scss'

export default function ExtensionShimmer() {
    return (
        <div className={styles.shell}>
            <div className={styles.hero} />

            <div className={styles.topTags}>
                <div className={styles.tag} />
                <div className={styles.tagSmall} />
            </div>

            <div className={styles.metaBar}>
                <div className={styles.metaGrid}>
                    {Array.from({ length: 5 }, (_, index) => (
                        <div key={index} className={styles.metaItem}>
                            <Line short />
                            <Line />
                        </div>
                    ))}
                </div>

                <div className={styles.actions}>
                    <div className={styles.actionWide} />
                    <div className={styles.action} />
                    <div className={styles.action} />
                </div>
            </div>

            <div className={styles.tabs}>
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className={styles.tab} />
                ))}
            </div>

            <div className={styles.content}>
                <div className={styles.codeBlock} />
                <div className={styles.sectionTitle} />
                <div className={styles.paragraph}>
                    <Line />
                    <Line />
                    <Line short />
                </div>
                <div className={styles.codeBlockLarge} />
            </div>
        </div>
    )
}
