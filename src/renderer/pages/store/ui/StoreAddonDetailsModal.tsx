import { useEffect, useRef, useState } from 'react'

import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { FaGithub } from 'react-icons/fa'
import {
    MdChevronLeft,
    MdChevronRight,
    MdClose,
    MdDataArray,
    MdDownload,
    MdInventory2,
    MdLabel,
    MdLanguage,
    MdLightMode,
    MdMenuBook,
    MdSchedule,
    MdStar,
    MdStarBorder,
    MdVerifiedUser,
} from 'react-icons/md'

import GetStoreAddonMetaQuery from '@entities/addon/api/getStoreAddonMeta.query'
import RateStoreAddonMutation from '@entities/addon/api/rateStoreAddon.mutation'
import apolloClient from '@shared/api/apolloClient'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import ExtensionCardStore from '@shared/ui/PSUI/ExtensionCardStore'
import { Avatar } from '@shared/ui/PSUI/Image'
import MarkdownContent from '@shared/ui/PSUI/MarkdownContent'
import toast from '@shared/ui/toast'
import TooltipButton from '@shared/ui/tooltip_button'

import * as st from '@pages/store/ui/StoreAddonDetailsModal.module.scss'

import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import type { Components } from 'react-markdown'

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

const formatAge = (value: string, locale: string) => {
    const timestamp = new Date(value).getTime()
    if (Number.isNaN(timestamp)) return value

    const days = Math.max(0, Math.round((Date.now() - timestamp) / 86_400_000))
    return locale === 'ru' ? `${days}д` : `${days}d`
}

type StoreAddonDetailsModalProps = {
    addon: StoreAddon | null
    isOpen: boolean
    isInstalled: boolean
    actionDisabled: boolean
    actionLabel: string
    currentUserId: string
    currentUserAvatarHash?: string | null
    currentUserAvatarType?: string | null
    relatedAddons: StoreAddon[]
    installingAddonId: string | null
    isAddonInstalled: (addonId: string) => boolean
    onAction: () => void
    onRelatedAddonAction: (addon: StoreAddon) => void
    onRelatedAddonSelect: (addon: StoreAddon) => void
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
    currentUserId,
    currentUserAvatarHash,
    currentUserAvatarType,
    relatedAddons,
    installingAddonId,
    isAddonInstalled,
    onAction,
    onRelatedAddonAction,
    onRelatedAddonSelect,
    onAuthorClick,
    onRatingChange,
    onClose,
}: StoreAddonDetailsModalProps) {
    const { t, i18n } = useTranslation()
    const [readme, setReadme] = useState<string | null>(null)
    const [readmeAddonId, setReadmeAddonId] = useState<string | null>(null)
    const [readmeLoading, setReadmeLoading] = useState(true)
    const [hoveredRating, setHoveredRating] = useState(0)
    const [ratingSaving, setRatingSaving] = useState(false)
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const relatedRowRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setReadme(null)
        setReadmeAddonId(null)
        setHoveredRating(0)
        scrollAreaRef.current?.scrollTo({ top: 0 })
    }, [addon?.id])

    useEffect(() => {
        const addonId = addon?.id
        if (!isOpen || !addonId || readmeAddonId === addonId) return

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
                setReadme(response.data?.getStoreAddonMeta?.readme?.trim() || null)
                setReadmeAddonId(addonId)
            })
            .catch(error => {
                console.error('[Store] failed to load addon README', error)
                if (!active) return
                setReadme(null)
                setReadmeAddonId(addonId)
            })
            .finally(() => {
                if (active) setReadmeLoading(false)
            })

        return () => {
            active = false
        }
    }, [addon?.id, isOpen, readmeAddonId])

    if (!addon?.currentRelease) return null

    const release = addon.currentRelease
    const updatedAt = release.approvedAt || release.updatedAt
    const updatedLabel = formatAge(updatedAt, i18n.language)
    const downloadsLabel = new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(addon.downloadCount)
    const displayedRating = hoveredRating || addon.myRating || 0
    const canRateAddon = addon.submittedById !== currentUserId
    const isRatingPublic = addon.ratingAverage > 0
    const kindIcon = addon.type === 'theme' ? <MdLightMode /> : addon.type === 'script' ? <MdDataArray /> : <MdLanguage />
    const kindClass = addon.type === 'theme' ? st.kindTheme : addon.type === 'script' ? st.kindScript : st.kindWebAddon

    const submitRating = async (rating: number) => {
        if (ratingSaving) return
        setRatingSaving(true)
        const nextRating = addon.myRating === rating ? null : rating

        try {
            const response = await apolloClient.mutate<RateStoreAddonMutationData>({
                mutation: RateStoreAddonMutation,
                variables: { id: addon.id, rating: nextRating },
            })
            const summary = response.data?.rateStoreAddon
            if (!summary) throw new Error('EMPTY_ADDON_RATING_RESPONSE')
            onRatingChange(addon.id, summary)
            setHoveredRating(0)
        } catch (error) {
            console.error('[Store] failed to rate addon', error)
            toast.custom('error', t('common.errorTitle'), t('store.rating.failed'))
        } finally {
            setRatingSaving(false)
        }
    }

    const scrollRelated = (direction: -1 | 1) => {
        const row = relatedRowRef.current
        if (!row) return
        row.scrollBy({ left: direction * Math.max(470, row.clientWidth * 0.8), behavior: 'smooth' })
    }

    return (
        <CustomModalPS inline isOpen={isOpen} onClose={onClose} className={st.modal} backdropClassName={st.backdrop}>
            <button type="button" className={st.closeButton} onClick={onClose} aria-label={t('common.done')}>
                <MdClose aria-hidden="true" />
            </button>

            <div ref={scrollAreaRef} className={st.scrollArea}>
                <div className={st.heroBackdrop} aria-hidden="true">
                    <img
                        src={release.bannerUrl || fallbackBanner}
                        alt=""
                        onError={event => {
                            event.currentTarget.onerror = null
                            event.currentTarget.src = fallbackBanner
                        }}
                    />
                </div>

                <div className={st.contentShell}>
                    <header className={st.heroHeader}>
                        <div className={st.heroIdentity}>
                            {release.avatarUrl ? (
                                <img src={release.avatarUrl} alt="" className={st.heroAvatar} />
                            ) : (
                                <span className={st.heroAvatarFallback} />
                            )}
                            <h1 id="store-addon-details-title">{addon.name}</h1>
                            {release.usesOfficialTemplate ? (
                                <TooltipButton
                                    as="span"
                                    side="top"
                                    className={st.verifiedTooltip}
                                    tooltipText={t('store.badges.officialTemplate')}
                                >
                                    <MdVerifiedUser className={st.verified} aria-label={t('store.badges.officialTemplate')} />
                                </TooltipButton>
                            ) : null}
                            <span className={st.metaChip}>
                                <MdInventory2 aria-hidden="true" />v{release.version}
                            </span>
                            <span className={st.metaChip}>
                                <MdSchedule aria-hidden="true" />
                                {updatedLabel}
                            </span>
                            <span className={st.metaChip}>
                                <MdDownload aria-hidden="true" />
                                {downloadsLabel}
                            </span>
                        </div>

                        <button
                            type="button"
                            className={cn(st.actionButton, isInstalled ? st.dangerAction : st.installAction)}
                            onClick={onAction}
                            disabled={actionDisabled}
                        >
                            <MdDownload aria-hidden="true" />
                            {actionLabel}
                        </button>
                    </header>

                    <section className={st.overview}>
                        <div className={st.overviewCopy}>
                            {release.status === 'accepted' && (canRateAddon || isRatingPublic) ? (
                                <div className={st.ratingSection}>
                                    {canRateAddon ? (
                                        <>
                                            <Avatar
                                                className={st.ratingAvatar}
                                                hash={currentUserAvatarHash}
                                                ext={currentUserAvatarType || undefined}
                                                sizes="34px"
                                                alt=""
                                                allowAnimate
                                            />
                                            <div className={st.ratingControl}>
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
                                                                aria-pressed={addon.myRating === rating}
                                                            >
                                                                {active ? <MdStar /> : <MdStarBorder />}
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                                <span>{t('store.rating.hint')}</span>
                                            </div>
                                        </>
                                    ) : null}
                                    {isRatingPublic ? (
                                        <div className={st.ratingScore}>
                                            <strong>{addon.ratingAverage.toFixed(2)}</strong>
                                            <span>{t('store.rating.votesShort', { count: addon.ratingCount })}</span>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}

                            <p className={st.description}>{release.description}</p>

                            <section className={st.infoSection}>
                                <h2>{t('store.catalog.authors')}</h2>
                                <div className={st.chipRow}>
                                    {release.authors.map((author, index) => (
                                        <button
                                            key={`${author}:${index}`}
                                            type="button"
                                            className={cn(st.authorChip, index === 0 && st.primaryAuthorChip)}
                                            onClick={() => onAuthorClick(author)}
                                        >
                                            <span aria-hidden="true" />
                                            {author}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <section className={st.infoSection}>
                                <h2>{t('store.catalog.tags')}</h2>
                                <div className={st.chipRow}>
                                    <span className={cn(st.tagChip, st.kindChip, kindClass)}>
                                        {kindIcon}
                                        {t(`store.kind.${addon.type}`)}
                                    </span>
                                    {release.tags.map(tag => (
                                        <span key={tag} className={st.tagChip}>
                                            <MdLabel aria-hidden="true" />
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </section>

                            {release.githubUrl ? (
                                <section className={st.infoSection}>
                                    <h2>{t('store.catalog.links')}</h2>
                                    <button
                                        type="button"
                                        className={st.githubButton}
                                        onClick={() => void desktopApi.system.openExternal(release.githubUrl!)}
                                    >
                                        <FaGithub aria-hidden="true" />
                                        {t('store.catalog.openGithub')}
                                    </button>
                                </section>
                            ) : null}
                        </div>

                        <div className={st.overviewMedia}>
                            <img
                                src={release.bannerUrl || fallbackBanner}
                                alt=""
                                onError={event => {
                                    event.currentTarget.onerror = null
                                    event.currentTarget.src = fallbackBanner
                                }}
                            />
                        </div>
                    </section>

                    <section className={st.descriptionSection}>
                        <div className={st.sectionTitle}>
                            <MdMenuBook aria-hidden="true" />
                            <h2>{t('extensions.tabs.description')}</h2>
                        </div>

                        <div className={st.readmePanel}>
                            {readmeLoading ? (
                                <div className={st.readmeState}>{t('common.loading')}</div>
                            ) : readme ? (
                                <MarkdownContent className={st.markdown} components={{ a: MarkdownLink }}>
                                    {readme}
                                </MarkdownContent>
                            ) : (
                                <div className={st.fallbackDescription}>{release.description}</div>
                            )}
                        </div>
                    </section>

                    {relatedAddons.length ? (
                        <section className={st.relatedSection}>
                            <header className={st.relatedHeader}>
                                <h2>{t('store.catalog.otherAddons')}</h2>
                                <div className={st.relatedControls}>
                                    <button type="button" onClick={() => scrollRelated(-1)} aria-label={t('store.catalog.previous')}>
                                        <MdChevronLeft aria-hidden="true" />
                                    </button>
                                    <button type="button" onClick={() => scrollRelated(1)} aria-label={t('store.catalog.next')}>
                                        <MdChevronRight aria-hidden="true" />
                                    </button>
                                </div>
                            </header>

                            <div ref={relatedRowRef} className={st.relatedRow}>
                                {relatedAddons.map(relatedAddon => {
                                    const relatedRelease = relatedAddon.currentRelease
                                    if (!relatedRelease) return null
                                    const relatedInstalled = isAddonInstalled(relatedAddon.id)
                                    const relatedInstalling = installingAddonId === relatedAddon.id

                                    return (
                                        <ExtensionCardStore
                                            key={relatedAddon.id}
                                            variant="poster"
                                            title={relatedAddon.name}
                                            subtitle={relatedRelease.description}
                                            authors={relatedRelease.authors}
                                            downloads={formatAge(relatedRelease.approvedAt || relatedRelease.updatedAt, i18n.language)}
                                            topRightMeta={new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(
                                                relatedAddon.downloadCount,
                                            )}
                                            ratingAverage={relatedAddon.ratingAverage}
                                            ratingCount={relatedAddon.ratingCount}
                                            iconImage={relatedRelease.avatarUrl || undefined}
                                            backgroundImage={relatedRelease.bannerUrl || undefined}
                                            kind={relatedAddon.type}
                                            tags={relatedRelease.tags}
                                            usedAiDuringDevelopment={relatedRelease.usedAiDuringDevelopment}
                                            usesOfficialTemplate={relatedRelease.usesOfficialTemplate}
                                            downloadLabel={
                                                relatedInstalled
                                                    ? t('store.remove')
                                                    : relatedInstalling
                                                      ? t('common.importing')
                                                      : t('layout.installAction')
                                            }
                                            downloadDisabled={relatedInstalling || (!relatedInstalled && !relatedRelease.downloadUrl?.trim())}
                                            downloadInstalled={relatedInstalled}
                                            downloadVariant={relatedInstalled ? 'remove' : 'default'}
                                            onClick={() => onRelatedAddonSelect(relatedAddon)}
                                            onDownloadClick={() => onRelatedAddonAction(relatedAddon)}
                                            onAuthorClick={onAuthorClick}
                                        />
                                    )
                                })}
                            </div>
                        </section>
                    ) : null}
                </div>
            </div>
        </CustomModalPS>
    )
}
