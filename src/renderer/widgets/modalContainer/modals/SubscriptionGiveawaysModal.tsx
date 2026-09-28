import React, { useCallback, useEffect, useMemo, useState } from 'react'

import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdAccessTime, MdClose, MdRedeem, MdRefresh } from 'react-icons/md'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { useModalContext } from '@app/providers/modal'
import rendererHttpClient from '@shared/api/http/client'
import {
    invalidateSubscriptionGiveawaysSnapshot,
    loadSubscriptionGiveawaysSnapshot,
    type SubscriptionGiveaway,
} from '@shared/api/subscriptionGiveaways'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'

import * as styles from '@widgets/modalContainer/modals/SubscriptionGiveawaysModal.module.scss'

import type { Components } from 'react-markdown'

type SubscriptionGiveawayEntryResponse = {
    ok?: boolean
}

type GiveawayViewModel = {
    giveaway: SubscriptionGiveaway
    endsAtTime: number
    isEnterable: boolean
    hasEnded: boolean
    hasEntered: boolean
    remainingLabel: string
    endsAtLabel: string
    actionLabel: string
}

const getTime = (value: string) => {
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : null
}

const formatDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return new Intl.DateTimeFormat(undefined, {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
    }).format(date)
}

const getPlanParts = (planCode: string, durationMonths?: number | null) => {
    const normalized = planCode.trim().toLowerCase()
    const type = normalized.includes('infinite') ? 'infinite' : normalized.includes('basic') ? 'basic' : ''
    const duration =
        durationMonths === 12
            ? 'yearly'
            : durationMonths === 3
              ? 'quarterly'
              : durationMonths === 1
                ? 'monthly'
                : normalized.includes('year') || normalized.includes('annual')
                  ? 'yearly'
                  : normalized.includes('quarter') || normalized.includes('3m')
                    ? 'quarterly'
                    : normalized.includes('month')
                      ? 'monthly'
                      : ''
    return { duration, type }
}

const MarkdownLink: Components['a'] = ({ href, children }) => (
    <a href={href ?? '#'} target="_blank" rel="noreferrer">
        {children}
    </a>
)

const GiveawayDescription = ({ text }: { text: string }) => (
    <div className={styles.description}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: MarkdownLink, img: () => null }}>
            {text}
        </ReactMarkdown>
    </div>
)

const SkeletonList = () => (
    <div className={styles.skeletonList}>
        {[0, 1, 2].map(index => (
            <div className={styles.skeletonCard} key={index}>
                <div className={styles.skeletonMain}>
                    <div className={styles.skeletonTitleRow}>
                        <span className={styles.skeletonTitle} />
                        <span className={styles.skeletonStatus} />
                    </div>
                    <span className={styles.skeletonDescription} />
                    <div className={styles.skeletonMetaRow}>
                        <span />
                        <span />
                        <span />
                    </div>
                </div>
                <span className={styles.skeletonAction} />
            </div>
        ))}
    </div>
)

const SubscriptionGiveawaysModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen } = useModalContext()
    const isOpen = isModalOpen(Modals.SUBSCRIPTION_GIVEAWAYS)
    const [isLoading, setLoading] = useState(false)
    const [joiningId, setJoiningId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [giveaways, setGiveaways] = useState<SubscriptionGiveaway[]>([])
    const [enteredIds, setEnteredIds] = useState<Set<string>>(() => new Set())
    const [currentTime, setCurrentTime] = useState(() => Date.now())

    const close = useCallback(() => closeModal(Modals.SUBSCRIPTION_GIVEAWAYS), [Modals.SUBSCRIPTION_GIVEAWAYS, closeModal])

    const loadGiveaways = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const snapshot = await loadSubscriptionGiveawaysSnapshot({ force: true })
            setGiveaways(snapshot.giveaways)
            setEnteredIds(new Set(snapshot.enteredIds))
        } catch (loadError) {
            console.error('Failed to load subscription giveaways:', loadError)
            setError(t('header.giveaways.loadError'))
        } finally {
            setLoading(false)
        }
    }, [t])

    useEffect(() => {
        if (isOpen) {
            void loadGiveaways()
        }
    }, [isOpen, loadGiveaways])

    useEffect(() => {
        if (!isOpen) return

        const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 30000)
        return () => window.clearInterval(intervalId)
    }, [isOpen])

    const formatRemaining = useCallback(
        (endsAtTime: number | null) => {
            if (endsAtTime === null) return t('header.giveaways.timeUnknown')

            const diffMs = endsAtTime - currentTime
            if (diffMs <= 0) return t('header.giveaways.ended')

            const totalMinutes = Math.ceil(diffMs / 60000)
            const days = Math.floor(totalMinutes / 1440)
            const hours = Math.floor((totalMinutes % 1440) / 60)
            const minutes = totalMinutes % 60

            if (days > 0) return t('header.giveaways.remainingDays', { days, hours })
            if (hours > 0) return t('header.giveaways.remainingHours', { hours, minutes })
            return t('header.giveaways.remainingMinutes', { minutes })
        },
        [currentTime, t],
    )

    const formatPlanCode = useCallback(
        (planCode: string, durationMonths?: number | null) => {
            const { duration, type } = getPlanParts(planCode, durationMonths)
            if (!type) return planCode

            const typeLabel = t(`header.giveaways.planTypes.${type}`)
            const durationLabel = duration
                ? t(`header.giveaways.planDurations.${duration}`)
                : durationMonths
                  ? t('header.giveaways.planDurations.custom', { months: durationMonths })
                  : ''
            return durationLabel ? t('header.giveaways.planDisplay', { duration: durationLabel, type: typeLabel }) : typeLabel
        },
        [t],
    )

    const giveawayItems = useMemo<GiveawayViewModel[]>(() => {
        return giveaways
            .map(giveaway => {
                const startsAtTime = getTime(giveaway.startsAt)
                const endsAtTime = getTime(giveaway.endsAt)
                const hasStarted = startsAtTime === null || startsAtTime <= currentTime
                const hasEnded = endsAtTime !== null && endsAtTime <= currentTime
                const hasEntered = enteredIds.has(giveaway.uuid)
                const isEnterable = hasStarted && !hasEnded && !hasEntered

                return {
                    giveaway,
                    endsAtTime: endsAtTime ?? Number.MAX_SAFE_INTEGER,
                    isEnterable,
                    hasEnded,
                    hasEntered,
                    remainingLabel: formatRemaining(endsAtTime),
                    endsAtLabel: formatDate(giveaway.endsAt),
                    actionLabel: hasEntered
                        ? t('header.giveaways.entered')
                        : hasEnded
                          ? t('header.giveaways.ended')
                          : !hasStarted
                            ? t('header.giveaways.notStarted')
                            : t('header.giveaways.join'),
                }
            })
            .sort((a, b) => a.endsAtTime - b.endsAtTime)
    }, [currentTime, enteredIds, formatRemaining, giveaways, t])

    const enterableGiveawaysCount = useMemo(() => giveawayItems.filter(item => item.isEnterable).length, [giveawayItems])

    const handleEnter = useCallback(
        async (item: GiveawayViewModel) => {
            const { giveaway } = item
            setJoiningId(giveaway.uuid)

            try {
                const response = await rendererHttpClient.post<SubscriptionGiveawayEntryResponse>(
                    `/subscription/giveaways/${encodeURIComponent(giveaway.uuid)}/enter`,
                    { auth: true, body: {} },
                )

                if (!response.ok || !response.data?.ok) {
                    throw new Error('Failed to enter subscription giveaway')
                }

                invalidateSubscriptionGiveawaysSnapshot()
                setEnteredIds(current => new Set(current).add(giveaway.uuid))
                toast.custom('success', t('header.giveaways.enteredTitle'), t('header.giveaways.enteredText', { title: giveaway.title }))
            } catch (enterError) {
                console.error('Failed to enter subscription giveaway:', enterError)
                toast.custom('error', t('header.giveaways.enterErrorTitle'), t('header.giveaways.enterErrorText'))
            } finally {
                setJoiningId(null)
            }
        },
        [t],
    )

    const renderState = (icon: React.ReactNode, title: string, text?: string) => (
        <div className={styles.state}>
            <div className={styles.stateIcon}>{icon}</div>
            <div className={styles.stateTitle}>{title}</div>
            {text && <div className={styles.stateText}>{text}</div>}
        </div>
    )

    const renderContent = () => {
        if (isLoading && !giveawayItems.length) {
            return <SkeletonList />
        }

        if (error && !giveawayItems.length) {
            return renderState(<MdRefresh size={18} />, t('header.giveaways.errorTitle'), error)
        }

        if (!giveawayItems.length) {
            return renderState(<MdRedeem size={18} />, t('header.giveaways.emptyTitle'), t('header.giveaways.emptyText'))
        }

        return (
            <div className={styles.list}>
                {giveawayItems.map(item => {
                    const { giveaway } = item
                    const isJoining = joiningId === giveaway.uuid
                    const description = giveaway.description?.trim() ?? ''

                    return (
                        <article
                            className={cn(styles.card, {
                                [styles.cardEntered]: item.hasEntered,
                                [styles.cardEnded]: item.hasEnded,
                            })}
                            key={giveaway.uuid}
                        >
                            <div className={styles.cardMain}>
                                <div className={styles.titleRow}>
                                    <div className={styles.title}>{giveaway.title}</div>
                                </div>

                                {description && <GiveawayDescription text={description} />}

                                <div className={styles.cardFooter}>
                                    <div className={styles.metaRow}>
                                        <span>{formatPlanCode(giveaway.planCode, giveaway.durationMonths)}</span>
                                        <span>{t('header.giveaways.winners', { count: giveaway.winnersCount })}</span>
                                        <span className={styles.remaining}>
                                            <MdAccessTime size={13} />
                                            {item.remainingLabel}
                                        </span>
                                    </div>
                                    <div className={styles.cardActions}>
                                        {item.isEnterable || isJoining ? (
                                            <button
                                                type="button"
                                                className={styles.action}
                                                disabled={isJoining}
                                                onClick={() => void handleEnter(item)}
                                            >
                                                {isJoining ? t('header.giveaways.joining') : item.actionLabel}
                                            </button>
                                        ) : (
                                            <span className={item.hasEntered ? styles.actionEntered : styles.actionMuted}>{item.actionLabel}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </article>
                    )
                })}
            </div>
        )
    }

    return (
        <CustomModalPS className={styles.modal} isOpen={isOpen} onClose={close}>
            <div className={styles.content}>
                <div className={styles.header}>
                    <div className={styles.headingBlock}>
                        <div className={styles.titleLarge}>{t('header.giveaways.title')}</div>
                        <div className={styles.summary}>
                            <span>{t('header.giveaways.count', { count: giveawayItems.length })}</span>
                            <span>{t('header.giveaways.availableCount', { count: enterableGiveawaysCount })}</span>
                        </div>
                    </div>

                    <div className={styles.headerActions}>
                        <button
                            type="button"
                            className={cn(styles.refreshButton, { [styles.refreshButtonLoading]: isLoading })}
                            disabled={isLoading}
                            onClick={() => void loadGiveaways()}
                            aria-label={t('header.giveaways.refresh')}
                        >
                            <MdRefresh size={16} />
                        </button>
                        <button type="button" className={styles.closeButton} onClick={close} aria-label={t('common.ok')}>
                            <MdClose size={18} />
                        </button>
                    </div>
                </div>

                {error && giveawayItems.length > 0 && <div className={styles.inlineError}>{error}</div>}

                {renderContent()}
            </div>
        </CustomModalPS>
    )
}

export default SubscriptionGiveawaysModal
