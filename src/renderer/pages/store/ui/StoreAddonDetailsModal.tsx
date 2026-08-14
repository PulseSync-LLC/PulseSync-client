import { useEffect, useState } from 'react'
import cn from 'clsx'
import type { Components } from 'react-markdown'
import { FaGithub } from 'react-icons/fa'
import { MdClose, MdDownload, MdStar, MdStarBorder, MdVerifiedUser } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { Tab, TabList, Tabs } from '@pulsesync/uikit/navigation'
import GetStoreAddonMetaQuery from '@entities/addon/api/getStoreAddonMeta.query'
import RateStoreAddonMutation from '@entities/addon/api/rateStoreAddon.mutation'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import apolloClient from '@shared/api/apolloClient'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import MarkdownContent from '@shared/ui/PSUI/MarkdownContent'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'
import toast from '@shared/ui/toast'
import AddonRatingBadge from '@shared/ui/PSUI/AddonRatingBadge'
import * as st from '@pages/store/ui/StoreAddonDetailsModal.module.scss'

type ModalTab = 'description' | 'readme'

type StoreAddonMetaQuery = {
    getStoreAddonMeta: {
        readme?: string | null
    } | null
}

type AddonRatingSummary = {
    average: number
    count: number
    myRating: number | null
}

type RateStoreAddonMutationData = {
    rateStoreAddon: AddonRatingSummary
}

const fallbackBanner = staticAsset('assets/images/no_themeBackground.png')

const MarkdownLink: Components['a'] = ({ href, children }) => {
    const isExternal = Boolean(href && /^https?:\/\//i.test(href))

    return (
        <a
            href={href}
            onClick={event => {
                if (!isExternal || !href) return
                event.preventDefault()
                void desktopApi.system.openExternal(href)
            }}
        >
            {children}
        </a>
    )
}

type StoreAddonDetailsModalProps = {
    addon: StoreAddon | null
    isOpen: boolean
    isInstalled: boolean
    actionDisabled: boolean
    actionLabel: string
    onAction: () => void
    onAuthorClick: (author: string) => void
    onRatingChange: (addonId: string, summary: AddonRatingSummary) => void
    onClose: () => void
}

export default function StoreAddonDetailsModal({
    addon,
    isOpen,
    isInstalled,
    actionDisabled,
    actionLabel,
    onAction,
    onAuthorClick,
    onRatingChange,
    onClose,
}: StoreAddonDetailsModalProps) {
    const { t, i18n } = useTranslation()
    const [displayedAddon, setDisplayedAddon] = useState(addon)
    const [activeTab, setActiveTab] = useState<ModalTab>('readme')
    const [readme, setReadme] = useState<string | null>(null)
    const [readmeAddonId, setReadmeAddonId] = useState<string | null>(null)
    const [readmeLoading, setReadmeLoading] = useState(false)
    const [hoveredRating, setHoveredRating] = useState(0)
    const [ratingSaving, setRatingSaving] = useState(false)

    useEffect(() => {
        if (!addon) return
        setDisplayedAddon(addon)
    }, [addon])

    useEffect(() => {
        if (!addon?.id) return
        setActiveTab('readme')
        setReadme(null)
        setReadmeAddonId(null)
        setHoveredRating(0)
    }, [addon?.id])

    const visibleAddon = addon || displayedAddon
    const release = visibleAddon?.currentRelease

    useEffect(() => {
        const addonId = visibleAddon?.id
        if (!isOpen || activeTab !== 'readme' || !addonId || readmeAddonId === addonId) return

        let active = true
        setReadmeLoading(true)

        void apolloClient
            .query<StoreAddonMetaQuery>({
                query: GetStoreAddonMetaQuery,
                variables: { id: addonId },
                fetchPolicy: 'no-cache',
            })
            .then(response => {
                if (!active) return
                const nextReadme = response.data?.getStoreAddonMeta?.readme?.trim() || null
                setReadme(nextReadme)
                setReadmeAddonId(addonId)
                if (!nextReadme) setActiveTab('description')
            })
            .catch(error => {
                console.error('[Store] failed to load addon README', error)
                if (!active) return
                setReadme(null)
                setReadmeAddonId(addonId)
                setActiveTab('description')
            })
            .finally(() => {
                if (active) setReadmeLoading(false)
            })

        return () => {
            active = false
        }
    }, [activeTab, isOpen, readmeAddonId, visibleAddon?.id])

    if (!visibleAddon || !release) return null

    const readmeUnavailable = readmeAddonId === visibleAddon.id && !readme
    const changelog = Array.isArray(release.changelog) ? release.changelog : release.changelog ? [release.changelog] : []
    const updatedAt = release.approvedAt || release.updatedAt
    const updatedLabel = new Intl.DateTimeFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }).format(new Date(updatedAt))
    const downloadsLabel = new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(visibleAddon.downloadCount)
    const hasLogo = Boolean(release.avatarUrl)
    const displayedRating = hoveredRating || visibleAddon.myRating || 0

    const submitRating = async (rating: number) => {
        if (ratingSaving) return
        setRatingSaving(true)
        const nextRating = visibleAddon.myRating === rating ? null : rating

        try {
            const response = await apolloClient.mutate<RateStoreAddonMutationData>({
                mutation: RateStoreAddonMutation,
                variables: { id: visibleAddon.id, rating: nextRating },
            })
            const summary = response.data?.rateStoreAddon
            if (!summary) throw new Error('EMPTY_ADDON_RATING_RESPONSE')
            onRatingChange(visibleAddon.id, summary)
            setHoveredRating(0)
        } catch (error) {
            console.error('[Store] failed to rate addon', error)
            toast.custom('error', t('common.errorTitle'), t('store.rating.failed'))
        } finally {
            setRatingSaving(false)
        }
    }

    return (
        <CustomModalPS isOpen={isOpen} onClose={onClose} className={st.modal}>
            <div className={st.modalLayout}>
                <div className={st.summaryPane}>
                    <div className={st.summary}>
                        <div className={st.banner}>
                            <img
                                src={release.bannerUrl || fallbackBanner}
                                alt=""
                                onError={event => {
                                    event.currentTarget.onerror = null
                                    event.currentTarget.src = fallbackBanner
                                }}
                            />
                        </div>

                        <div className={cn(st.identityRow, !hasLogo && st.identityRowWithoutLogo)}>
                            {release.avatarUrl ? (
                                <div className={st.libraryLogo}>
                                    <img src={release.avatarUrl} alt="" />
                                </div>
                            ) : null}

                            <div className={st.actions}>
                                <button
                                    type="button"
                                    className={cn(st.actionButton, isInstalled ? st.dangerAction : st.installAction)}
                                    onClick={onAction}
                                    disabled={actionDisabled}
                                >
                                    <MdDownload aria-hidden="true" />
                                    {actionLabel}
                                </button>
                                <button type="button" className={st.closeButton} onClick={onClose} aria-label={t('common.done')}>
                                    <MdClose aria-hidden="true" />
                                </button>
                            </div>
                        </div>

                        <div className={st.copy}>
                            <div className={st.headingRow}>
                                <h1>{visibleAddon.name}</h1>
                                {release.usesOfficialTemplate ? (
                                    <MdVerifiedUser className={st.verified} aria-label={t('store.badges.officialTemplate')} />
                                ) : null}
                            </div>
                            <p>{release.description}</p>
                        </div>

                        <div className={st.metadata}>
                            <div className={st.metaItem}>
                                <span className={st.metaLabel}>{t('extensions.meta.version')}</span>
                                <span className={st.metaValue}>{release.version}</span>
                            </div>
                            <div className={st.metaItem}>
                                <span className={st.metaLabel}>{t('extensions.meta.updated')}</span>
                                <span className={st.metaValue}>{updatedLabel}</span>
                            </div>
                            <div className={st.metaItem}>
                                <span className={st.metaLabel}>{t('store.filters.downloads')}</span>
                                <span className={st.metaValue}>{downloadsLabel}</span>
                            </div>
                            <div className={st.metaItem}>
                                <span className={st.metaLabel}>{t('extensions.meta.source')}</span>
                                <span className={st.metaValue}>{t('extensions.source.store')}</span>
                            </div>
                        </div>

                        {release.status === 'accepted' ? (
                            <section className={st.ratingSection}>
                                <div className={st.ratingSummary}>
                                    {visibleAddon.ratingCount > 0 ? (
                                        <>
                                            <AddonRatingBadge average={visibleAddon.ratingAverage} count={visibleAddon.ratingCount} />
                                            <span>{t('store.rating.votes', { count: visibleAddon.ratingCount })}</span>
                                        </>
                                    ) : (
                                        <span className={st.ratingPrompt}>{t('store.rating.title')}</span>
                                    )}
                                </div>
                                <div className={st.ratingStars} onMouseLeave={() => setHoveredRating(0)}>
                                    {[1, 2, 3, 4, 5].map(rating => {
                                        const active = rating <= displayedRating
                                        return (
                                            <button
                                                key={rating}
                                                type="button"
                                                className={cn(active && st.ratingStarActive)}
                                                onMouseEnter={() => setHoveredRating(rating)}
                                                onFocus={() => setHoveredRating(rating)}
                                                onBlur={() => setHoveredRating(0)}
                                                onClick={() => void submitRating(rating)}
                                                disabled={ratingSaving}
                                                aria-label={t('store.rating.set', { rating })}
                                                aria-pressed={visibleAddon.myRating === rating}
                                            >
                                                {active ? <MdStar /> : <MdStarBorder />}
                                            </button>
                                        )
                                    })}
                                </div>
                            </section>
                        ) : null}

                        <section className={st.section}>
                            <h2>{t('store.catalog.authors')}</h2>
                            <div className={st.authorRow}>
                                {release.authors.map(author => (
                                    <button key={author} type="button" className={st.authorButton} onClick={() => onAuthorClick(author)}>
                                        <span aria-hidden="true" />
                                        {author}
                                    </button>
                                ))}
                            </div>
                        </section>

                        {release.tags?.length ? (
                            <section className={st.section}>
                                <h2>{t('store.catalog.tags')}</h2>
                                <div className={st.tagRow}>
                                    {release.tags.map(tag => (
                                        <span key={tag} className={st.tagChip}>
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </section>
                        ) : null}

                        {release.githubUrl ? (
                            <section className={st.section}>
                                <h2>{t('store.catalog.links')}</h2>
                                <button type="button" className={st.githubButton} onClick={() => desktopApi.system.openExternal(release.githubUrl!)}>
                                    <FaGithub aria-hidden="true" />
                                    {t('store.catalog.openGithub')}
                                </button>
                            </section>
                        ) : null}
                    </div>
                </div>

                <div className={st.detailPane}>
                    <Tabs value={activeTab} onChange={value => setActiveTab(value as ModalTab)} className={st.modalTabsRoot}>
                        <TabList className={st.modalTabs}>
                            {!readmeUnavailable ? <Tab value="readme">README</Tab> : null}
                            <Tab value="description">{t('extensions.tabs.description')}</Tab>
                        </TabList>
                    </Tabs>

                    <div className={st.detailContent}>
                        {activeTab === 'description' || readmeUnavailable ? (
                            <div className={st.descriptionPanel}>
                                <p>{release.description}</p>
                                {changelog.length ? (
                                    <section className={st.changelogSection}>
                                        <h2>{t('extensions.tabs.changelog')}</h2>
                                        <div className={st.changelog}>
                                            {changelog.map((entry, index) => (
                                                <div key={index}>{entry}</div>
                                            ))}
                                        </div>
                                    </section>
                                ) : null}
                            </div>
                        ) : (
                            <div className={st.readmePanel}>
                                {readmeLoading ? (
                                    <div className={st.readmeState}>{t('common.loading')}</div>
                                ) : readme ? (
                                    <MarkdownContent components={{ a: MarkdownLink }}>{readme}</MarkdownContent>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </CustomModalPS>
    )
}
