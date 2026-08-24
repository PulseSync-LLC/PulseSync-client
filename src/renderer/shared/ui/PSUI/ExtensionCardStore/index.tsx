import React, { useEffect, useRef, useState } from 'react'

import { Badge } from '@pulsesync/uikit/data-display'
import cn from 'clsx'
import {
    MdCheck,
    MdDataArray,
    MdDeleteForever,
    MdDownload,
    MdLabel,
    MdLanguage,
    MdLightMode,
    MdSchedule,
    MdStar,
    MdVerifiedUser,
} from 'react-icons/md'

import { t } from '@app/i18n'
import { staticAsset } from '@shared/lib/staticAssets'
import AddonRatingBadge from '@shared/ui/PSUI/AddonRatingBadge'
import TooltipButton from '@shared/ui/tooltip_button'

import * as st from '@shared/ui/PSUI/ExtensionCardStore/card.module.scss'

type ExtensionTheme = 'purple' | 'red' | 'wave'
type ExtensionCardSize = 'default' | 'large'
type ExtensionStatus = 'accepted' | 'active' | 'deprecated' | 'pending' | 'rejected'
type ExtensionType = 'css' | 'js' | 'both'
type DownloadVariant = 'default' | 'installed' | 'remove'
type AddonKind = 'theme' | 'script' | 'web-addon'
type StoreCardVariant = 'poster' | 'list'

const fallbackPosterBanner = staticAsset('assets/images/no_themeBackground.png')

export interface ExtensionCardStoreProps {
    title: string
    subtitle: string
    authors: string[]
    downloads?: string
    topRightMeta?: string
    ratingAverage?: number
    ratingCount?: number
    theme?: ExtensionTheme
    size?: ExtensionCardSize
    iconImage?: string
    backgroundImage?: string
    className?: string
    status?: ExtensionStatus
    type?: ExtensionType
    kind?: AddonKind
    tags?: string[]
    usedAiDuringDevelopment?: boolean
    usesOfficialTemplate?: boolean
    onDownloadClick?: () => void
    onAuthorClick?: (author: string) => void
    onClick?: () => void
    downloadLabel?: string
    downloadDisabled?: boolean
    downloadInstalled?: boolean
    downloadVariant?: DownloadVariant
    isPreInstalled?: boolean
    animationsEnabledRef?: React.MutableRefObject<boolean>
    variant?: StoreCardVariant
}

type VisibilityState = {
    isIntersecting: boolean
    shouldAnimate: boolean
}

const useIntersectionObserver = (ref: React.RefObject<HTMLElement | null>, animationsEnabledRef?: React.MutableRefObject<boolean>) => {
    const [visibilityState, setVisibilityState] = useState<VisibilityState>({
        isIntersecting: false,
        shouldAnimate: animationsEnabledRef?.current ?? true,
    })

    useEffect(() => {
        if (!ref.current) return
        if (typeof IntersectionObserver === 'undefined') {
            setVisibilityState({ isIntersecting: true, shouldAnimate: false })
            return
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) {
                    setVisibilityState(current => (current.isIntersecting ? { ...current, isIntersecting: false } : current))
                    return
                }

                setVisibilityState({
                    isIntersecting: true,
                    shouldAnimate: animationsEnabledRef?.current ?? true,
                })
            },
            { threshold: 0.05, rootMargin: '50%' },
        )

        observer.observe(ref.current)
        return () => observer.disconnect()
    }, [animationsEnabledRef, ref])

    return visibilityState
}

const getKindLabel = (kind?: AddonKind) => (kind ? t(`store.kind.${kind}`) : '')
const getKindIcon = (kind: AddonKind) => (kind === 'theme' ? <MdLightMode /> : kind === 'script' ? <MdDataArray /> : <MdLanguage />)
const getKindVariant = (kind: AddonKind): 'success' | 'warning' | 'info' => (kind === 'theme' ? 'info' : kind === 'script' ? 'warning' : 'success')
const getKindToneClass = (kind: AddonKind) => (kind === 'theme' ? st.toneInfo : kind === 'script' ? st.toneWarning : st.toneSuccess)

const getStatusVariant = (status: ExtensionStatus): 'success' | 'danger' | 'warning' | 'info' | 'neutral' => {
    if (status === 'pending') return 'warning'
    if (status === 'rejected' || status === 'deprecated') return 'danger'
    return 'success'
}

const ExtensionCardStore: React.FC<ExtensionCardStoreProps> = ({
    title,
    subtitle,
    authors,
    downloads,
    topRightMeta,
    ratingAverage = 0,
    ratingCount,
    iconImage,
    backgroundImage,
    className,
    status,
    kind,
    tags = [],
    usedAiDuringDevelopment = false,
    usesOfficialTemplate = false,
    onAuthorClick,
    onClick,
    onDownloadClick,
    downloadLabel,
    downloadDisabled = false,
    downloadInstalled = false,
    downloadVariant = 'default',
    animationsEnabledRef,
    variant = 'list',
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const visibilityState = useIntersectionObserver(containerRef, animationsEnabledRef)
    const visibleTags = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean))).slice(0, variant === 'poster' ? 2 : 1)

    return (
        <div ref={containerRef} className={cn(st.cardMount, variant === 'poster' ? st.cardMountPoster : st.cardMountList)}>
            {visibilityState.isIntersecting ? (
                <article
                    className={cn(
                        st.card,
                        variant === 'poster' ? st.posterCard : st.listCard,
                        !visibilityState.shouldAnimate && st.softFadeIn,
                        onClick && st.cardClickable,
                        className,
                    )}
                    onClick={event => {
                        if (!onClick) return
                        if (event.target instanceof Element && event.target.closest('button, a')) return
                        onClick()
                    }}
                    onKeyDown={event => {
                        if (!onClick || event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
                        event.preventDefault()
                        onClick()
                    }}
                    role={onClick ? 'button' : undefined}
                    tabIndex={onClick ? 0 : undefined}
                    aria-label={onClick ? title : undefined}
                >
                    {variant === 'poster' ? (
                        <div className={st.posterMedia}>
                            <img
                                src={backgroundImage || fallbackPosterBanner}
                                alt=""
                                className={st.posterBanner}
                                onError={event => {
                                    event.currentTarget.onerror = null
                                    event.currentTarget.src = fallbackPosterBanner
                                }}
                            />
                            {iconImage ? <img src={iconImage} alt="" className={st.posterIcon} /> : <span className={st.posterIconFallback} />}
                            <button
                                type="button"
                                className={cn(st.posterAction, downloadVariant === 'remove' && st.removeAction)}
                                onClick={onDownloadClick}
                                disabled={downloadDisabled}
                            >
                                {downloadVariant === 'remove' ? <MdDeleteForever /> : downloadInstalled ? <MdCheck /> : <MdDownload />}
                                {downloadLabel || t('store.download')}
                            </button>
                        </div>
                    ) : iconImage ? (
                        <img src={iconImage} alt="" className={st.listIcon} />
                    ) : (
                        <span className={st.listIconFallback} />
                    )}

                    <div className={st.cardCopy}>
                        <div className={st.titleRow}>
                            <h3>{title}</h3>
                            {usesOfficialTemplate ? (
                                <TooltipButton
                                    as="span"
                                    side="top"
                                    className={st.verifiedTooltip}
                                    tooltipText={t('store.badges.officialTemplate')}
                                >
                                    <MdVerifiedUser className={st.verified} aria-label={t('store.badges.officialTemplate')} />
                                </TooltipButton>
                            ) : null}
                        </div>
                        <p>{subtitle}</p>
                        <div className={st.metaRow}>
                            {ratingCount !== undefined ? <AddonRatingBadge average={ratingAverage} /> : null}
                            {status ? (
                                <Badge uppercase={false} size="md" variant={getStatusVariant(status)} className={st.metaBadge}>
                                    {t(`store.status.${status}`)}
                                </Badge>
                            ) : null}
                            {kind ? (
                                <Badge
                                    uppercase={false}
                                    size="md"
                                    variant={getKindVariant(kind)}
                                    icon={getKindIcon(kind)}
                                    className={cn(st.metaBadge, getKindToneClass(kind))}
                                >
                                    {getKindLabel(kind)}
                                </Badge>
                            ) : null}
                            {visibleTags.map(tag => (
                                <Badge key={tag} uppercase={false} size="md" icon={<MdLabel />} className={cn(st.metaBadge, st.neutralBadge)}>
                                    {tag}
                                </Badge>
                            ))}
                            {authors.map((author, index) => (
                                <button key={`${author}:${index}`} type="button" className={st.authorButton} onClick={() => onAuthorClick?.(author)}>
                                    <Badge
                                        uppercase={false}
                                        size="md"
                                        variant="info"
                                        className={cn(st.authorBadge, st.toneInfo)}
                                    >
                                        <span aria-hidden="true" />
                                        {author}
                                    </Badge>
                                </button>
                            ))}
                            {topRightMeta ? (
                                <Badge uppercase={false} size="md" icon={<MdDownload />} className={cn(st.metaBadge, st.neutralBadge)}>
                                    {topRightMeta}
                                </Badge>
                            ) : null}
                            {downloads ? (
                                <Badge uppercase={false} size="md" icon={<MdSchedule />} className={cn(st.metaBadge, st.neutralBadge)}>
                                    {downloads}
                                </Badge>
                            ) : null}
                            {usedAiDuringDevelopment ? (
                                <TooltipButton as="span" className={st.aiTooltip} tooltipText={t('store.badges.aiUsageTooltip')} side="top">
                                    <Badge uppercase={false} size="md" variant="warning" icon={<MdStar />} className={st.metaBadge}>
                                        {t('store.badges.aiUsage')}
                                    </Badge>
                                </TooltipButton>
                            ) : null}
                        </div>
                    </div>

                    {variant === 'list' ? (
                        <button
                            type="button"
                            className={cn(st.listAction, downloadVariant === 'remove' && st.removeAction)}
                            onClick={onDownloadClick}
                            disabled={downloadDisabled}
                        >
                            {downloadVariant === 'remove' ? <MdDeleteForever /> : downloadInstalled ? <MdCheck /> : <MdDownload />}
                            {downloadLabel || t('store.download')}
                        </button>
                    ) : null}
                </article>
            ) : null}
        </div>
    )
}

export default ExtensionCardStore
