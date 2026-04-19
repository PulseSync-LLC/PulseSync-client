import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import cn from 'clsx'
import { useNavigate } from 'react-router-dom'
import { MdKeyboardArrowDown, MdKeyboardArrowUp, MdSearch } from 'react-icons/md'
import { isDev } from '@common/appConfig'
import PageLayout from '@widgets/layout/PageLayout'
import * as st from '@pages/store/store.module.scss'
import ExtensionCardStore from '@shared/ui/PSUI/ExtensionCardStore'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import { useTranslation } from 'react-i18next'
import apolloClient from '@shared/api/apolloClient'
import type Addon from '@entities/addon/model/addon.interface'
import GetModerationAddonsQuery from '@entities/addon/api/getModerationAddons.query'
import GetStoreAddonsQuery from '@entities/addon/api/getStoreAddons.query'
import type { StoreAddon, StoreAddonsPayload } from '@entities/addon/model/storeAddon.interface'
import StoreShimmer from '@shared/ui/PSUI/Shimmer/variants/StoreShimmer'
import MainEvents from '@common/types/mainEvents'
import toast from '@shared/ui/toast'
import UserContext from '@entities/user/model/context'
import { useModalContext } from '@app/providers/modal'

type StoreAddonsQuery = {
    getStoreAddons: StoreAddonsPayload
}

type ModerationAddonsQuery = {
    getModerationAddons: StoreAddon[]
}

type StoreTypeFilter = 'all' | 'theme' | 'script'
type StoreSortKey = 'latestRelease' | 'name' | 'downloads'

const STORE_CARD_MIN_HEIGHT = 238
const STORE_GRID_ROW_GAP = 16
const STORE_GRID_OVERSCAN_ROWS = 2

function resolveTheme(index: number): 'purple' | 'red' | 'wave' {
    const themes: Array<'purple' | 'red' | 'wave'> = ['purple', 'red', 'wave']
    return themes[index % themes.length]
}

function resolveType(type: StoreAddon['type']): 'css' | 'js' {
    return type === 'script' ? 'js' : 'css'
}

function formatDate(value: string, locale?: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date)
}

function getDefaultSortOrder(sortKey: StoreSortKey): 'asc' | 'desc' {
    return sortKey === 'name' ? 'asc' : 'desc'
}

export default function StorePage() {
    const INITIAL_SHIMMER_FADE_MS = 180

    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const { addons: installedAddons, setAddons: setInstalledAddons, user } = useContext(UserContext)
    const { Modals, openModal, setModalState } = useModalContext()
    const [addons, setAddons] = useState<StoreAddon[]>([])
    const [storeTotalCount, setStoreTotalCount] = useState(0)
    const [pendingAddons, setPendingAddons] = useState<StoreAddon[]>([])
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
    const [typeFilter, setTypeFilter] = useState<StoreTypeFilter>('all')
    const [sortKey, setSortKey] = useState<StoreSortKey>('latestRelease')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => getDefaultSortOrder('latestRelease'))
    const [loading, setLoading] = useState(true)
    const [installingAddonId, setInstallingAddonId] = useState<string | null>(null)
    const [isInitialShimmerVisible, setIsInitialShimmerVisible] = useState(true)
    const [isInitialShimmerFading, setIsInitialShimmerFading] = useState(false)
    const [scrollTop, setScrollTop] = useState(0)
    const [scrollViewportHeight, setScrollViewportHeight] = useState(0)
    const [gridTopOffset, setGridTopOffset] = useState(0)
    const [gridColumns, setGridColumns] = useState(2)
    const animationsEnabledRef = useRef(false)
    const shimmerFadeTimeoutRef = useRef<number | null>(null)
    const shimmerFadeRafRef = useRef<number | null>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const storeContentRef = useRef<HTMLDivElement>(null)
    const isDeveloperUser = user?.perms === 'developer' || isDev

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery.trim())
        }, 250)

        return () => window.clearTimeout(timeoutId)
    }, [searchQuery])

    useEffect(() => {
        let active = true

        const loadAddons = async () => {
            setLoading(true)
            try {
                const response = await apolloClient.query<StoreAddonsQuery>({
                    query: GetStoreAddonsQuery,
                    variables: {
                        page: 1,
                        pageSize: 50,
                        search: debouncedSearchQuery || undefined,
                        sortBy: sortKey,
                        sortOrder,
                        type: typeFilter === 'all' ? undefined : typeFilter,
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!active) return
                setAddons(Array.isArray(response.data?.getStoreAddons?.addons) ? response.data.getStoreAddons.addons : [])
                setStoreTotalCount(Number(response.data?.getStoreAddons?.totalCount) || 0)
            } catch (error) {
                console.error('[Store] failed to load addons', error)
                if (active) {
                    setAddons([])
                    setStoreTotalCount(0)
                }
            } finally {
                if (active) {
                    setLoading(false)
                }
            }
        }

        void loadAddons()

        return () => {
            active = false
        }
    }, [debouncedSearchQuery, sortKey, sortOrder, typeFilter])

    useEffect(() => {
        let active = true

        if (!isDeveloperUser || !user?.id || user.id === '-1') {
            setPendingAddons([])
            return () => {
                active = false
            }
        }

        const loadPendingAddons = async () => {
            try {
                const response = await apolloClient.query<ModerationAddonsQuery>({
                    query: GetModerationAddonsQuery,
                    variables: {
                        search: debouncedSearchQuery || undefined,
                        sortBy: sortKey,
                        sortOrder,
                        status: 'pending',
                        type: typeFilter === 'all' ? undefined : typeFilter,
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!active) return

                setPendingAddons(
                    (Array.isArray(response.data?.getModerationAddons) ? response.data.getModerationAddons : []).filter(addon => {
                        const release = addon.currentRelease
                        return Boolean(release && release.status === 'pending')
                    }),
                )
            } catch (error) {
                console.error('[Store] failed to load moderation addons', error)
                if (active) {
                    setPendingAddons([])
                }
            }
        }

        void loadPendingAddons()

        return () => {
            active = false
        }
    }, [debouncedSearchQuery, isDeveloperUser, sortKey, sortOrder, typeFilter, user?.id])

    const installedStoreAddons = useMemo(
        () => new Map(installedAddons.filter(addon => addon.storeAddonId).map(addon => [addon.storeAddonId!, addon])),
        [installedAddons],
    )

    const shouldRenderCards = addons.length > 0
    const hasSearchOrFilter = Boolean(debouncedSearchQuery) || typeFilter !== 'all'
    const shouldShowPendingSection = isDeveloperUser && (pendingAddons.length > 0 || hasSearchOrFilter)

    const handleSortOptionClick = useCallback((option: StoreSortKey) => {
        setSortKey(option)
        setSortOrder(currentOrder => {
            if (sortKey === option) {
                return currentOrder === 'asc' ? 'desc' : 'asc'
            }

            return getDefaultSortOrder(option)
        })
    }, [sortKey])

    const handleStoreAddonAction = useCallback(
        async (addon: StoreAddon, release: StoreAddon['currentRelease'], installedStoreAddon?: Addon) => {
            if (!window.desktopEvents || !release || !addon.id || installingAddonId === addon.id) return

            if (installedStoreAddon) {
                const removeInstalledAddon = async () => {
                    setInstallingAddonId(addon.id)
                    const toastId = toast.custom('loading', t('common.delete'), t('common.pleaseWait'))

                    try {
                        const result = await window.desktopEvents.invoke(MainEvents.DELETE_ADDON_DIRECTORY, installedStoreAddon.path)
                        if (!result?.success) {
                            throw new Error(result?.reason || 'DELETE_FAILED')
                        }

                        const nextInstalledAddons = await window.desktopEvents.invoke(MainEvents.GET_ADDONS)
                        setInstalledAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])
                        toast.custom('success', t('common.doneTitle'), t('store.removeComplete', { title: addon.name }), {
                            id: toastId,
                        })
                    } catch (error: any) {
                        toast.custom('error', t('common.errorTitle'), t('store.removeFailed', { title: addon.name }), {
                            id: toastId,
                        })
                        console.error('[Store] failed to remove addon', error)
                    } finally {
                        setInstallingAddonId(current => (current === addon.id ? null : current))
                    }
                }

                setModalState(Modals.BASIC_CONFIRMATION, {
                    description: t('store.removeConfirm', { title: addon.name }),
                    confirmLabel: t('modals.basicConfirmation.delete'),
                    confirmVariant: 'danger',
                    onConfirm: () => {
                        void removeInstalledAddon()
                    },
                })
                openModal(Modals.BASIC_CONFIRMATION)
                return
            }

            const downloadUrl = release.downloadUrl?.trim()
            if (!downloadUrl) {
                toast.custom('error', t('common.errorTitle'), t('store.installUnavailable', { title: addon.name }))
                return
            }

            setInstallingAddonId(addon.id)
            const toastId = toast.custom('loading', t('common.importTitle'), t('common.pleaseWait'))

            try {
                const result = await window.desktopEvents.invoke(MainEvents.INSTALL_STORE_ADDON, {
                    id: addon.id,
                    downloadUrl,
                    title: addon.name,
                })

                if (!result?.success) {
                    throw new Error(result?.reason || 'INSTALL_FAILED')
                }

                const nextInstalledAddons = await window.desktopEvents.invoke(MainEvents.GET_ADDONS)
                setInstalledAddons(Array.isArray(nextInstalledAddons) ? nextInstalledAddons : [])

                toast.custom('success', t('common.doneTitle'), t('store.installComplete', { title: addon.name }), { id: toastId })
            } catch (error: any) {
                toast.custom('error', t('common.errorTitle'), t('store.installFailed', { title: addon.name }), { id: toastId })
                console.error('[Store] failed to install addon', error)
            } finally {
                setInstallingAddonId(current => (current === addon.id ? null : current))
            }
        },
        [Modals.BASIC_CONFIRMATION, installingAddonId, openModal, setInstalledAddons, setModalState, t],
    )

    const renderStoreCard = useCallback(
        (addon: StoreAddon, index: number, options?: { forceStatus?: 'pending' | 'rejected' | 'accepted'; topRightMeta?: string }) => {
            const release = addon.currentRelease
            if (!release) return null

            const installedStoreAddon = installedStoreAddons.get(addon.id)
            const isInstalled = !!installedStoreAddon
            const hasDownloadUrl = Boolean(release.downloadUrl?.trim())

            return (
                <ExtensionCardStore
                    key={addon.id}
                    theme={resolveTheme(index)}
                    title={addon.name}
                    subtitle={release.description}
                    version={`v${release.version}`}
                    authors={release.authors}
                    status={options?.forceStatus}
                    downloads={
                        release.status === 'accepted'
                            ? t('store.approvedAt', {
                                  date: formatDate(release.approvedAt || release.updatedAt, i18n.language),
                              })
                            : t('store.submittedAt', {
                                  date: formatDate(release.createdAt, i18n.language),
                              })
                    }
                    topRightMeta={options?.topRightMeta}
                    type={resolveType(addon.type)}
                    kind={addon.type}
                    backgroundImage={release.bannerUrl || undefined}
                    iconImage={release.avatarUrl || undefined}
                    downloadInstalled={isInstalled}
                    downloadVariant={isInstalled ? 'remove' : 'default'}
                    downloadDisabled={installingAddonId === addon.id || (!isInstalled && !hasDownloadUrl)}
                    animationsEnabledRef={animationsEnabledRef}
                    downloadLabel={
                        isInstalled
                            ? t('store.remove')
                            : installingAddonId === addon.id
                              ? t('common.importing')
                              : hasDownloadUrl
                                ? t('store.download')
                                : t('common.notAvailable')
                    }
                    onDownloadClick={() => {
                        void handleStoreAddonAction(addon, release, installedStoreAddon)
                    }}
                    onAuthorClick={author => {
                        if (!author) return
                        navigate(`/profile/${encodeURIComponent(author)}`)
                    }}
                />
            )
        },
        [animationsEnabledRef, handleStoreAddonAction, i18n.language, installedStoreAddons, installingAddonId, navigate, t],
    )

    const measureVirtualGrid = useCallback(() => {
        const container = scrollContainerRef.current
        const content = storeContentRef.current

        if (!container || !content) return

        const nextViewportHeight = container.clientHeight
        const nextGridTopOffset = content.offsetTop
        const nextGridColumns = window.innerWidth <= 1024 ? 1 : 2

        setScrollViewportHeight(prevHeight => (prevHeight === nextViewportHeight ? prevHeight : nextViewportHeight))
        setGridTopOffset(prevOffset => (prevOffset === nextGridTopOffset ? prevOffset : nextGridTopOffset))
        setGridColumns(prevColumns => (prevColumns === nextGridColumns ? prevColumns : nextGridColumns))
    }, [])

    useLayoutEffect(() => {
        const runMeasure = () => {
            measureVirtualGrid()
            setScrollTop(prevScrollTop => {
                const nextScrollTop = scrollContainerRef.current?.scrollTop ?? 0
                return prevScrollTop === nextScrollTop ? prevScrollTop : nextScrollTop
            })
        }

        runMeasure()

        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(runMeasure)

        if (observer) {
            if (scrollContainerRef.current) observer.observe(scrollContainerRef.current)
            if (storeContentRef.current) observer.observe(storeContentRef.current)
        }

        window.addEventListener('resize', runMeasure)

        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', runMeasure)
        }
    }, [measureVirtualGrid])

    const virtualizedGrid = useMemo(() => {
        if (!addons.length) {
            return {
                startIndex: 0,
                topSpacerHeight: 0,
                bottomSpacerHeight: 0,
                visibleAddons: [] as StoreAddon[],
            }
        }

        const columns = Math.max(1, gridColumns)
        const totalRows = Math.ceil(addons.length / columns)
        const rowHeight = STORE_CARD_MIN_HEIGHT + STORE_GRID_ROW_GAP
        const totalHeight = totalRows * STORE_CARD_MIN_HEIGHT + Math.max(0, totalRows - 1) * STORE_GRID_ROW_GAP
        const relativeScrollTop = Math.max(0, scrollTop - gridTopOffset)
        const visibleHeight = Math.max(rowHeight, scrollViewportHeight - Math.max(0, gridTopOffset - scrollTop))
        const startRow = Math.min(totalRows, Math.max(0, Math.floor(relativeScrollTop / rowHeight) - STORE_GRID_OVERSCAN_ROWS))
        const endRow = Math.min(totalRows, Math.ceil((relativeScrollTop + visibleHeight) / rowHeight) + STORE_GRID_OVERSCAN_ROWS)
        const startIndex = startRow * columns
        const endIndex = Math.min(addons.length, endRow * columns)
        const visibleAddons = addons.slice(startIndex, endIndex)
        const visibleRowCount = Math.ceil(visibleAddons.length / columns)
        const topSpacerHeight = Math.min(totalHeight, startRow * rowHeight)
        const renderedHeight = visibleRowCount * STORE_CARD_MIN_HEIGHT + Math.max(0, visibleRowCount - 1) * STORE_GRID_ROW_GAP
        const bottomSpacerHeight = Math.max(0, totalHeight - topSpacerHeight - renderedHeight)

        return {
            startIndex,
            topSpacerHeight,
            bottomSpacerHeight,
            visibleAddons,
        }
    }, [addons, gridColumns, gridTopOffset, scrollTop, scrollViewportHeight])

    const shimmerCount = useMemo(() => {
        const columns = Math.max(1, gridColumns)
        const fallbackViewportHeight =
            scrollViewportHeight || (typeof window === 'undefined' ? STORE_CARD_MIN_HEIGHT * 2 : Math.max(window.innerHeight - 220, STORE_CARD_MIN_HEIGHT * 2))
        const rowHeight = STORE_CARD_MIN_HEIGHT + STORE_GRID_ROW_GAP
        const rows = Math.max(2, Math.ceil(fallbackViewportHeight / rowHeight) + 1)

        return columns * rows
    }, [gridColumns, scrollViewportHeight])

    const clearInitialShimmerTimers = useCallback(() => {
        if (shimmerFadeTimeoutRef.current !== null) {
            window.clearTimeout(shimmerFadeTimeoutRef.current)
            shimmerFadeTimeoutRef.current = null
        }

        if (shimmerFadeRafRef.current !== null) {
            window.cancelAnimationFrame(shimmerFadeRafRef.current)
            shimmerFadeRafRef.current = null
        }
    }, [])

    useEffect(() => {
        return () => {
            clearInitialShimmerTimers()
        }
    }, [clearInitialShimmerTimers])

    useEffect(() => {
        if (loading) return

        if (!shouldRenderCards) {
            clearInitialShimmerTimers()
            setIsInitialShimmerVisible(false)
            setIsInitialShimmerFading(false)
            return
        }

        if (!isInitialShimmerVisible || isInitialShimmerFading) return

        shimmerFadeRafRef.current = window.requestAnimationFrame(() => {
            shimmerFadeRafRef.current = null
            setIsInitialShimmerFading(true)

            shimmerFadeTimeoutRef.current = window.setTimeout(() => {
                shimmerFadeTimeoutRef.current = null
                setIsInitialShimmerVisible(false)
                setIsInitialShimmerFading(false)
            }, INITIAL_SHIMMER_FADE_MS)
        })
    }, [INITIAL_SHIMMER_FADE_MS, clearInitialShimmerTimers, isInitialShimmerFading, isInitialShimmerVisible, loading, shouldRenderCards])

    const content = useMemo(() => {
        if (loading) {
            return (
                <div className={st.store_loading}>
                    <StoreShimmer count={shimmerCount} />
                </div>
            )
        }

        if (!addons.length) {
            return <div className={st.store_state}>{t(hasSearchOrFilter ? 'store.noResults' : 'store.empty')}</div>
        }

        return (
            <div className={st.initialContentShell}>
                {virtualizedGrid.topSpacerHeight > 0 && (
                    <div className={st.store_virtualSpacer} style={{ height: `${virtualizedGrid.topSpacerHeight}px` }} aria-hidden="true" />
                )}

                <div className={st.store_grid}>
                    {virtualizedGrid.visibleAddons.map((addon, index) =>
                        renderStoreCard(addon, virtualizedGrid.startIndex + index, {
                            topRightMeta: new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(addon.downloadCount),
                        }),
                    )}
                </div>

                {virtualizedGrid.bottomSpacerHeight > 0 && (
                    <div className={st.store_virtualSpacer} style={{ height: `${virtualizedGrid.bottomSpacerHeight}px` }} aria-hidden="true" />
                )}

                {isInitialShimmerVisible && (
                    <div className={cn(st.initialShimmerOverlay, isInitialShimmerFading && st.initialShimmerOverlayHidden)}>
                        <StoreShimmer count={shimmerCount} />
                    </div>
                )}
            </div>
        )
    }, [
        addons,
        hasSearchOrFilter,
        i18n.language,
        installedStoreAddons,
        installingAddonId,
        isInitialShimmerFading,
        isInitialShimmerVisible,
        loading,
        renderStoreCard,
        shimmerCount,
        t,
        virtualizedGrid.startIndex,
        virtualizedGrid.bottomSpacerHeight,
        virtualizedGrid.topSpacerHeight,
        virtualizedGrid.visibleAddons,
    ])

    return (
        <PageLayout title={t('pages.store.title')}>
            <Scrollbar
                ref={scrollContainerRef}
                className={st.containerFix}
                classNameInner={cn(st.containerFixInner, (loading || isInitialShimmerVisible) && st.containerFixInnerLocked)}
                onScroll={event => {
                    animationsEnabledRef.current = true
                    const nextScrollTop = event.currentTarget?.scrollTop ?? scrollContainerRef.current?.scrollTop ?? 0
                    setScrollTop(prevScrollTop => {
                        return prevScrollTop === nextScrollTop ? prevScrollTop : nextScrollTop
                    })
                }}
            >
                <section className={st.store}>
                    <header className={st.store_header}>
                        <div className={st.store_title}>{t('pages.store.headerTitle')}</div>
                        <div className={st.store_subtitle}>{t('pages.store.headerSubtitle')}</div>
                        <div className={st.store_toolbar}>
                            <div className={cn(st.store_toolbarSide, st.store_toolbarSideStart)}>
                                <div className={st.store_filterOptions}>
                                    {(['all', 'theme', 'script'] as const).map(option => (
                                        <button
                                            key={option}
                                            type="button"
                                            className={cn(st.store_filterChip, st.store_typeChip, typeFilter === option && st.store_filterChipActive)}
                                            onClick={() => setTypeFilter(option)}
                                        >
                                            {option === 'all'
                                                ? t('filters.type.all')
                                                : option === 'theme'
                                                  ? t('filters.type.themes')
                                                  : t('filters.type.scripts')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div
                                className={st.store_search}
                                onClick={event => (event.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
                            >
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={event => setSearchQuery(event.target.value)}
                                    placeholder={t('store.searchPlaceholder')}
                                    className={st.store_search_input}
                                />
                                <MdSearch className={st.store_search_icon} />
                            </div>
                            <div className={cn(st.store_toolbarSide, st.store_toolbarSideEnd)}>
                                <div className={st.store_filterOptions}>
                                    {(['latestRelease', 'name', 'downloads'] as const).map(option => (
                                        <button
                                            key={option}
                                            type="button"
                                            className={cn(st.store_filterChip, sortKey === option && st.store_filterChipActive)}
                                            onClick={() => handleSortOptionClick(option)}
                                        >
                                            <span className={st.store_filterChipContent}>
                                                <span>
                                                    {option === 'latestRelease'
                                                        ? t('store.filters.latestRelease')
                                                        : option === 'name'
                                                          ? t('store.filters.name')
                                                          : t('store.filters.downloads')}
                                                </span>
                                                {sortKey === option &&
                                                    (sortOrder === 'asc' ?
                                                        <MdKeyboardArrowUp className={st.store_filterChipDirection} />
                                                    :   <MdKeyboardArrowDown className={st.store_filterChipDirection} />)}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className={st.store_subtitle_stats}>{''.concat(String(addons?.length)).concat('/').concat(String(storeTotalCount))}</div>
                    </header>

                    <div ref={storeContentRef}>{content}</div>

                    {shouldShowPendingSection ? (
                        <section className={st.store_section}>
                            <div className={st.store_sectionHeader}>
                                <div>
                                    <h2 className={st.store_sectionTitle}>{t('store.pendingSectionTitle')}</h2>
                                    <p className={st.store_sectionSubtitle}>{t('store.pendingSectionSubtitle')}</p>
                                </div>
                            </div>

                            {pendingAddons.length ? (
                                <div className={st.store_sectionGrid}>
                                    {pendingAddons.map((addon, index) =>
                                        renderStoreCard(addon, index, {
                                            forceStatus: 'pending',
                                        }),
                                    )}
                                </div>
                            ) : (
                                <div className={st.store_sectionState}>{t('store.pendingEmpty')}</div>
                            )}
                        </section>
                    ) : null}
                </section>
            </Scrollbar>
        </PageLayout>
    )
}
