import React from 'react'
import * as styles from '@shared/ui/PSUI/Shimmer/variants/StoreShimmer.module.scss'

type StoreShimmerProps = {
    count?: number
    variant?: 'catalog' | 'list'
}

function ListRows({ count }: { count: number }) {
    return (
        <div className={styles.shell}>
            {Array.from({ length: count }, (_, index) => (
                <div key={index} className={styles.card}>
                    <div className={styles.icon} />
                    <div className={styles.copy}>
                        <div className={styles.titleRow}>
                            <div className={styles.title} />
                            <div className={styles.version} />
                        </div>
                        <div className={styles.description} />
                        <div className={styles.meta}>
                            <div />
                            <div />
                            <div />
                            <div />
                        </div>
                    </div>
                    <div className={styles.button} />
                </div>
            ))}
        </div>
    )
}

function PosterCard() {
    return (
        <div className={styles.posterCard}>
            <div className={styles.posterVisual}>
                <div className={styles.posterBanner} />
                <div className={styles.posterIcon} />
                <div className={styles.posterButton} />
            </div>
            <div className={styles.posterCopy}>
                <div className={styles.posterTitle} />
                <div className={styles.posterDescription} />
                <div className={styles.posterMeta}>
                    <div />
                    <div />
                    <div />
                    <div />
                </div>
            </div>
        </div>
    )
}

export default function StoreShimmer({ count = 6, variant = 'list' }: StoreShimmerProps) {
    if (variant === 'list') return <ListRows count={count} />

    return (
        <div className={styles.catalogShell}>
            <div className={styles.heroTopline}>
                <div className={styles.heroIdentity}>
                    <div className={styles.heroAvatar} />
                    <div className={styles.heroTitle} />
                    <div className={styles.heroBadge} />
                    <div className={styles.heroBadgeSmall} />
                    <div className={styles.heroBadge} />
                </div>
                <div className={styles.heroAction} />
            </div>

            <div className={styles.heroBody}>
                <div className={styles.heroCopy}>
                    <div className={styles.heroDescription}>
                        <div />
                        <div />
                    </div>
                    <div className={styles.heroGroup}>
                        <div className={styles.heroGroupTitle} />
                        <div className={styles.heroPills}>
                            <div />
                            <div />
                        </div>
                    </div>
                    <div className={styles.heroGroup}>
                        <div className={styles.heroGroupTitle} />
                        <div className={styles.heroPills}>
                            <div />
                            <div />
                            <div />
                        </div>
                    </div>
                    <div className={styles.heroGroupTitle} />
                    <div className={styles.heroLink} />
                </div>
                <div className={styles.heroMedia} />
            </div>

            <div className={styles.pager}>
                <div className={styles.pagerArrow} />
                <div className={styles.pagerActive} />
                <div />
                <div />
                <div />
                <div className={styles.pagerArrow} />
            </div>

            <section className={styles.catalogSection}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitle} />
                    <div className={styles.sectionActions}>
                        <div />
                        <div />
                    </div>
                </div>
                <div className={styles.posterRail}>
                    <PosterCard />
                    <PosterCard />
                    <PosterCard />
                </div>
            </section>

            <section className={styles.catalogSection}>
                <div className={styles.sectionHeader}>
                    <div className={styles.sectionTitleWide} />
                </div>
                <ListRows count={2} />
            </section>
        </div>
    )
}
