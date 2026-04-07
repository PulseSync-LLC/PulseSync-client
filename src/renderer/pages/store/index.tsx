import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import cn from 'clsx'
import { useNavigate } from 'react-router-dom'
import { MdSearch } from 'react-icons/md'
import PageLayout from '@widgets/layout/PageLayout'
import * as st from '@pages/store/store.module.scss'
import ExtensionCardStore from '@shared/ui/PSUI/ExtensionCardStore'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import { useTranslation } from 'react-i18next'
import apolloClient from '@shared/api/apolloClient'
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

export default function StorePage() {
    const INITIAL_SHIMMER_FADE_MS = 180

    const { t, i18n } = useTranslation()
    const navigate = useNavigate()
    const { addons: installedAddons, setAddons: setInstalledAddons } = useContext(UserContext)
    const { Modals, openModal, setModalState } = useModalContext()
    const [addons, setAddons] = useState<StoreAddon[]>([])
    const [searchQuery, setSearchQuery] = useState('')
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
                    },
                    fetchPolicy: 'no-cache',
                })

                if (!active) return
                setAddons(Array.isArray(response.data?.getStoreAddons?.addons) ? response.data.getStoreAddons.addons : [])
            } catch (error) {
                console.error('[Store] failed to load addons', error)
                if (active) {
                    setAddons([])
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
    }, [])

    const installedStoreAddons = useMemo(
        () => new Map(installedAddons.filter(addon => addon.storeAddonId).map(addon => [addon.storeAddonId!, addon])),
        [installedAddons],
    )

    const filteredAddons = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) {
            return addons
        }

        return addons.filter(addon => {
            const haystack = [
                addon.name,
                addon.currentRelease?.description || '',
                addon.type,
                addon.currentRelease?.version || '',
                ...(addon.currentRelease?.authors || []),
            ]
                .join(' ')
                .toLowerCase()
            return haystack.includes(query)
        })
    }, [addons, searchQuery])

    const shouldRenderCards = filteredAddons.length > 0

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
        if (!filteredAddons.length) {
            return {
                startIndex: 0,
                topSpacerHeight: 0,
                bottomSpacerHeight: 0,
                visibleAddons: [] as StoreAddon[],
            }
        }

        const columns = Math.max(1, gridColumns)
        const totalRows = Math.ceil(filteredAddons.length / columns)
        const rowHeight = STORE_CARD_MIN_HEIGHT + STORE_GRID_ROW_GAP
        const totalHeight = totalRows * STORE_CARD_MIN_HEIGHT + Math.max(0, totalRows - 1) * STORE_GRID_ROW_GAP
        const relativeScrollTop = Math.max(0, scrollTop - gridTopOffset)
        const visibleHeight = Math.max(rowHeight, scrollViewportHeight - Math.max(0, gridTopOffset - scrollTop))
        const startRow = Math.min(totalRows, Math.max(0, Math.floor(relativeScrollTop / rowHeight) - STORE_GRID_OVERSCAN_ROWS))
        const endRow = Math.min(totalRows, Math.ceil((relativeScrollTop + visibleHeight) / rowHeight) + STORE_GRID_OVERSCAN_ROWS)
        const startIndex = startRow * columns
        const endIndex = Math.min(filteredAddons.length, endRow * columns)
        const visibleAddons = filteredAddons.slice(startIndex, endIndex)
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
    }, [filteredAddons, gridColumns, gridTopOffset, scrollTop, scrollViewportHeight])

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
            return <div className={st.store_state}>{t('store.empty')}</div>
        }

        if (!filteredAddons.length) {
            return <div className={st.store_state}>{t('store.noResults')}</div>
        }

        return (
            <div className={st.initialContentShell}>
                {virtualizedGrid.topSpacerHeight > 0 && (
                    <div className={st.store_virtualSpacer} style={{ height: `${virtualizedGrid.topSpacerHeight}px` }} aria-hidden="true" />
                )}

                <div className={st.store_grid}>
                    {virtualizedGrid.visibleAddons.map((addon, index) => {
                        const release = addon.currentRelease
                        if (!release) return null
                        const installedStoreAddon = installedStoreAddons.get(addon.id)
                        const isInstalled = !!installedStoreAddon
                        const visibleIndex = virtualizedGrid.startIndex + index

                        return (
                            <ExtensionCardStore
                                key={addon.id}
                                theme={resolveTheme(visibleIndex)}
                                title={addon.name}
                                subtitle={release.description}
                                version={`v${release.version}`}
                                authors={release.authors}
                                downloads={t('store.approvedAt', {
                                    date: formatDate(release.approvedAt || release.updatedAt, i18n.language),
                                })}
                                topRightMeta={new Intl.NumberFormat(i18n.language === 'ru' ? 'ru-RU' : 'en-US').format(addon.downloadCount)}
                                type={resolveType(addon.type)}
                                kind={addon.type}
                                backgroundImage={release.bannerUrl || undefined}
                                iconImage={release.avatarUrl || undefined}
                                downloadInstalled={isInstalled}
                                downloadVariant={isInstalled ? 'remove' : 'default'}
                                downloadDisabled={installingAddonId === addon.id}
                                animationsEnabledRef={animationsEnabledRef}
                                downloadLabel={
                                    isInstalled
                                        ? t('store.remove')
                                        : installingAddonId === addon.id
                                          ? t('common.importing')
                                          : t('store.download')
                                }
                                onDownloadClick={async () => {
                                    if (installingAddonId === addon.id || !window.desktopEvents) return

                                    if (installedStoreAddon) {
                                        const addonToRemove = installedStoreAddon
                                        const removeInstalledAddon = async () => {
                                            setInstallingAddonId(addon.id)
                                            const toastId = toast.custom('loading', t('common.delete'), t('common.pleaseWait'))

                                            try {
                                                const result = await window.desktopEvents.invoke(MainEvents.DELETE_ADDON_DIRECTORY, addonToRemove.path)
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

                                    setInstallingAddonId(addon.id)
                                    const toastId = toast.custom('loading', t('common.importTitle'), t('common.pleaseWait'))

                                    try {
                                        const result = await window.desktopEvents.invoke(MainEvents.INSTALL_STORE_ADDON, {
                                            id: addon.id,
                                            downloadUrl: release.downloadUrl,
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
                                }}
                                onAuthorClick={author => {
                                    if (!author) return
                                    navigate(`/profile/${encodeURIComponent(author)}`)
                                }}
                            />
                        )
                    })}
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
        filteredAddons,
        i18n.language,
        installedStoreAddons,
        installingAddonId,
        isInitialShimmerFading,
        isInitialShimmerVisible,
        loading,
        Modals,
        navigate,
        openModal,
        setInstalledAddons,
        setModalState,
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
                    setScrollTop(prevScrollTop => {
                        const nextScrollTop = event.currentTarget.scrollTop
                        return prevScrollTop === nextScrollTop ? prevScrollTop : nextScrollTop
                    })
                }}
            >
                <section className={st.store}>
                    <header className={st.store_header}>
                        <div className={st.store_title}>{t('pages.store.headerTitle')}</div>
                        <div className={st.store_subtitle}>{t('pages.store.headerSubtitle')}</div>
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
                    </header>

                    <div ref={storeContentRef}>{content}</div>
                </section>
            </Scrollbar>
        </PageLayout>
    )
}
