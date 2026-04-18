import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import config from '@common/appConfig'
import MainEvents from '@common/types/mainEvents'
import { useNews } from '@app/providers/news'
import ButtonV2 from '@shared/ui/buttonV2'

import * as styles from './home.module.scss'

type NewsImageProps = {
    alt: string
    src: string
    className: string
}

function NewsImage({ alt, src, className }: NewsImageProps) {
    const [hidden, setHidden] = useState(false)

    if (!src || hidden) {
        return null
    }

    return <img className={className} src={src} alt={alt} onError={() => setHidden(true)} />
}

type NewsCardProps = {
    className: string
    descriptionClassName: string
    item: {
        id: number
        slug: string
        title: string
        description: string
        image: string
        date: number
        author: string
        readTime: number
    }
    onOpen: (slug: string) => void
    formatDate: (value: number) => string
    readTimeLabel: string
    metaSeparator?: string
}

function NewsCard({ className, descriptionClassName, item, onOpen, formatDate, readTimeLabel, metaSeparator }: NewsCardProps) {
    return (
        <article
            className={className}
            onClick={() => onOpen(item.slug)}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(item.slug)
                }
            }}
            role="button"
            tabIndex={0}
        >
            <div className={styles.newsFeaturedMedia}>
                <div className={styles.newsFeaturedMediaFallback} />
                <NewsImage className={styles.newsFeaturedImage} src={item.image} alt={item.title} />
            </div>

            <div className={styles.newsFeaturedContent}>
                <div className={styles.newsMetaRow}>
                    <span className={styles.newsMetaAuthor}>{item.author}</span>
                    {metaSeparator && <span className={styles.newsMetaDot}>{metaSeparator}</span>}
                    <span className={styles.newsMetaDate}>{formatDate(item.date)}</span>
                    {metaSeparator && <span className={styles.newsMetaDot}>{metaSeparator}</span>}
                    <span className={styles.newsMetaReadTime}>{readTimeLabel}</span>
                </div>

                <h3 className={styles.newsFeaturedTitle}>{item.title}</h3>
                <p className={descriptionClassName}>{item.description}</p>
            </div>
        </article>
    )
}

export default function HomeNewsSection() {
    const { t, i18n } = useTranslation()
    const { news, loading, error, refresh } = useNews()

    const [featuredNews, secondaryNews] = useMemo(() => {
        const [featured, ...rest] = news
        return [featured ?? null, rest]
    }, [news])

    const formatDate = useCallback(
        (value: number) => {
            const date = new Date(Number(value))
            if (Number.isNaN(date.getTime())) {
                return String(value)
            }

            return new Intl.DateTimeFormat(i18n.language, {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
            }).format(date)
        },
        [i18n.language],
    )

    const formatCompactDate = useCallback((value: number) => {
        const date = new Date(Number(value))
        if (Number.isNaN(date.getTime())) {
            return String(value)
        }

        const day = String(date.getDate()).padStart(2, '0')
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const year = String(date.getFullYear()).slice(-2)
        return `${day}.${month}.${year}`
    }, [])

    const formatCompactReadTime = useCallback(
        (value: number) => `${value} ${i18n.language === 'ru' ? 'мин' : 'min'}`,
        [i18n.language],
    )

    const openArticle = useCallback((slug: string) => {
        if (!slug) {
            return
        }

        window.desktopEvents?.send(MainEvents.OPEN_EXTERNAL, `${config.WEBSITE_URL}/news/${slug}`)
    }, [])

    const openNewsList = useCallback(() => {
        window.desktopEvents?.send(MainEvents.OPEN_EXTERNAL, `${config.WEBSITE_URL}/news`)
    }, [])

    const renderState = () => {
        if (loading) {
            return (
                <div className={styles.newsState} aria-hidden="true">
                    <div className={styles.newsSkeletonFeatured}>
                        <div className={styles.newsSkeletonImage} />
                        <div className={styles.newsSkeletonContent}>
                            <div className={styles.newsSkeletonMeta} />
                            <div className={styles.newsSkeletonTitle} />
                            <div className={styles.newsSkeletonDescription} />
                            <div className={styles.newsSkeletonDescriptionShort} />
                        </div>
                    </div>
                    <div className={styles.newsSkeletonList}>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className={styles.newsSkeletonItem}>
                                <div className={styles.newsSkeletonThumb} />
                                <div className={styles.newsSkeletonItemContent}>
                                    <div className={styles.newsSkeletonMeta} />
                                    <div className={styles.newsSkeletonItemTitle} />
                                    <div className={styles.newsSkeletonDescriptionShort} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )
        }

        if (error) {
            return (
                <div className={styles.newsState}>
                    <div className={styles.newsStateTitle}>{t('pages.home.newsError')}</div>
                    <div className={styles.newsStateDescription}>{t('common.fetchFailed')}</div>
                    <ButtonV2 type="button" className={styles.newsStateButton} onClick={() => void refresh()}>
                        {t('common.refresh')}
                    </ButtonV2>
                </div>
            )
        }

        return (
            <div className={styles.newsState}>
                <div className={styles.newsStateTitle}>{t('pages.home.newsEmpty')}</div>
                <div className={styles.newsStateDescription}>{t('pages.home.newsEmptyDescription')}</div>
                <ButtonV2 type="button" className={styles.newsStateButton} onClick={openNewsList}>
                    {t('pages.home.newsOpenAll')}
                </ButtonV2>
            </div>
        )
    }

    return (
        <section className={`${styles.panel} ${styles.newsPanel}`}>
            <div className={styles.newsHeader}>
                <div>
                    <h2 className={styles.panelTitle}>{t('pages.home.news')}</h2>
                    <p className={styles.newsSubtitle}>{t('pages.home.newsSubtitle')}</p>
                </div>
                <ButtonV2 type="button" className={styles.newsHeaderAction} onClick={openNewsList}>
                    {t('pages.home.newsOpenAll')}
                </ButtonV2>
            </div>

            <div className={styles.newsBody}>
                {!featuredNews ? (
                    renderState()
                ) : (
                    <div className={styles.newsScroller}>
                        <div className={styles.newsScrollerInner}>
                            <NewsCard
                                className={styles.newsFeaturedCard}
                                descriptionClassName={styles.newsFeaturedDescription}
                                item={featuredNews}
                                onOpen={openArticle}
                                formatDate={formatDate}
                                readTimeLabel={t('pages.home.newsReadTime', { count: featuredNews.readTime })}
                                metaSeparator={t('common.emDash')}
                            />

                            {secondaryNews.length > 0 && (
                                <div className={styles.newsList}>
                                    {secondaryNews.map(item => (
                                        <NewsCard
                                            key={item.id}
                                            className={styles.newsListItem}
                                            descriptionClassName={styles.newsListItemDescription}
                                            item={item}
                                            onOpen={openArticle}
                                            formatDate={formatCompactDate}
                                            readTimeLabel={formatCompactReadTime(item.readTime)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}
