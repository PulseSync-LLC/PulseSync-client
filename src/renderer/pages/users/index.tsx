import PageLayout from '@widgets/layout/PageLayout'
import * as s from '@pages/users/users.module.scss'
import { useLayoutEffect, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import cn from 'clsx'
import UserInterface from '@entities/user/model/user.interface'
import GetAllUsersQuery from '@entities/user/api/getAllUsers.query'
import apolloClient from '@shared/api/apolloClient'
import debounce from 'lodash.debounce'
import { MdKeyboardArrowDown, MdKeyboardArrowUp, MdSearch } from 'react-icons/md'
import toast from '@shared/ui/toast'
import UserCardV2 from '@entities/user/ui/userCardV2'
import Scrollbar from '@shared/ui/PSUI/Scrollbar'
import { useTranslation } from 'react-i18next'
import { Banner } from '@shared/ui/PSUI/Image'
import { getBannerMediaUrls } from '@shared/lib/mediaVariants'
import UsersShimmer from '@shared/ui/PSUI/Shimmer/variants/UsersShimmer'
import type { SortState, UserGridMetrics } from '@pages/users/model/userList'
import { SORT_FIELDS, USER_CARD_HEIGHT, USER_CARD_MIN_WIDTH, getUserGridMetrics, sortUsers } from '@pages/users/model/userList'

export default function UsersPage() {
    const INITIAL_SHIMMER_FADE_MS = 180

    const [loading, setLoading] = useState(true)
    const [isFetchingMore, setIsFetchingMore] = useState(false)
    const [hasLoadMoreError, setHasLoadMoreError] = useState(false)
    const [users, setUsers] = useState<UserInterface[]>([])
    const [page, setPage] = useState(1)
    const [maxPages, setMaxPages] = useState(1)
    const [sorting, setSorting] = useState<SortState>([{ id: 'lastOnline', desc: true }])
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })
    const [isHeaderHovered, setIsHeaderHovered] = useState(false)
    const [isInitialShimmerVisible, setIsInitialShimmerVisible] = useState(true)
    const [isInitialShimmerFading, setIsInitialShimmerFading] = useState(false)

    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const headerRef = useRef<HTMLDivElement>(null)
    const userPageRef = useRef<HTMLDivElement>(null)
    const loadMoreRef = useRef<HTMLDivElement>(null)
    const sortRefs = useRef<(HTMLDivElement | null)[]>(new Array(4).fill(null))
    const queryKeyRef = useRef(0)
    const nextPagePendingRef = useRef(false)
    const animationsEnabledRef = useRef(false)
    const scrollDirectionRef = useRef<'up' | 'down'>('down')
    const lastScrollTopRef = useRef(0)
    const shimmerFadeTimeoutRef = useRef<number | null>(null)
    const shimmerFadeRafRef = useRef<number | null>(null)
    const queryParamsRef = useRef<{ perPage: number; sorting: SortState; search: string }>({
        perPage: 0,
        sorting,
        search: '',
    })
    const nav = useNavigate()
    const { t } = useTranslation()
    const [gridMetrics, setGridMetrics] = useState<UserGridMetrics | null>(null)

    const openProfile = useCallback(
        (u: any) => {
            const name: string | undefined = typeof u === 'string' ? u : u?.username
            if (!name) return
            nav(`/profile/${encodeURIComponent(name)}`)
        },
        [nav],
    )

    const setSortRef =
        (idx: number) =>
        (el: HTMLDivElement | null): void => {
            sortRefs.current[idx] = el
        }

    const measureGrid = useCallback(() => {
        const container = containerRef.current
        const userPage = userPageRef.current

        if (!container || !userPage) return

        const userPageStyles = window.getComputedStyle(userPage)
        const paddingLeft = Number.parseFloat(userPageStyles.paddingLeft) || 0
        const paddingRight = Number.parseFloat(userPageStyles.paddingRight) || 0
        const paddingTop = Number.parseFloat(userPageStyles.paddingTop) || 0
        const contentWidth = Math.max(USER_CARD_MIN_WIDTH, userPage.clientWidth - paddingLeft - paddingRight)
        const topOffset = Math.max(0, userPage.offsetTop + paddingTop)
        const availableHeight = Math.max(USER_CARD_HEIGHT, container.clientHeight - topOffset)
        const nextMetrics = getUserGridMetrics(contentWidth, availableHeight)

        setGridMetrics(prevMetrics => {
            if (
                prevMetrics &&
                prevMetrics.columns === nextMetrics.columns &&
                prevMetrics.visibleRows === nextMetrics.visibleRows &&
                prevMetrics.visibleCount === nextMetrics.visibleCount &&
                prevMetrics.perPage === nextMetrics.perPage &&
                prevMetrics.prefetchOffsetPx === nextMetrics.prefetchOffsetPx
            ) {
                return prevMetrics
            }

            return nextMetrics
        })
    }, [])

    const calculateIndicator = useCallback((index: number) => {
        const el = sortRefs.current[index]
        if (el && el.parentElement) {
            const rect = el.getBoundingClientRect()
            const containerRect = el.parentElement.getBoundingClientRect()
            const nextLeft = rect.left - containerRect.left
            const nextWidth = rect.width

            setIndicatorStyle(prevStyle => {
                if (prevStyle.left === nextLeft && prevStyle.width === nextWidth) {
                    return prevStyle
                }

                return {
                    left: nextLeft,
                    width: nextWidth,
                }
            })
        }
    }, [])

    const fetchUsers = useCallback(
        async (page_: number, perPage_: number, sorting_: SortState, search_: string, mode: 'replace' | 'append', queryKey: number) => {
            if (mode === 'append') {
                setIsFetchingMore(true)
            } else {
                setLoading(true)
            }

            try {
                const result = await apolloClient.query({
                    query: GetAllUsersQuery,
                    variables: { perPage: perPage_, page: page_, sorting: sorting_, search: search_ },
                    fetchPolicy: 'no-cache',
                })

                if (queryKey !== queryKeyRef.current) return

                const data: any = result.data || {}
                const payload = data.getUsersWithPagination || null

                if (payload) {
                    const raw: UserInterface[] = Array.isArray(payload.users) ? payload.users : []
                    const totalPages: number = payload.totalPages || 1
                    const nextUsers = sortUsers(raw, sorting_)

                    setUsers(prevUsers => {
                        if (mode !== 'append') return nextUsers

                        const knownIds = new Set(prevUsers.map(user => user.id))
                        return [...prevUsers, ...nextUsers.filter(user => !knownIds.has(user.id))]
                    })
                    setMaxPages(totalPages)
                    if (mode === 'append') setHasLoadMoreError(false)
                } else {
                    if (mode !== 'append') setUsers([])
                    setMaxPages(1)
                }
            } catch (e) {
                if (queryKey !== queryKeyRef.current) return
                console.error(e)
                if (mode === 'append') {
                    setHasLoadMoreError(true)
                    setPage(prevPage => (prevPage >= page_ ? Math.max(1, page_ - 1) : prevPage))
                }
                toast.custom('error', t('common.errorTitle'), t('users.fetchError'))
            } finally {
                if (mode === 'append') {
                    nextPagePendingRef.current = false
                    if (queryKey === queryKeyRef.current) setIsFetchingMore(false)
                } else if (queryKey === queryKeyRef.current) {
                    setLoading(false)
                }
            }
        },
        [t],
    )

    const debouncedFetchUsers = useMemo(() => debounce(fetchUsers, 300), [fetchUsers])

    const getPT = useCallback(() => Math.round(window.innerHeight * 0.15), [])
    const [pt, setPt] = useState(getPT())

    const fallbackGridMetrics = useMemo(() => {
        const estimatedWidth = typeof window === 'undefined' ? USER_CARD_MIN_WIDTH : Math.max(window.innerWidth - 80, USER_CARD_MIN_WIDTH)
        const estimatedHeight = typeof window === 'undefined' ? USER_CARD_HEIGHT : Math.max(window.innerHeight - pt - 140, USER_CARD_HEIGHT)

        return getUserGridMetrics(estimatedWidth, estimatedHeight)
    }, [pt])

    const effectiveGridMetrics = gridMetrics ?? fallbackGridMetrics
    const perPage = gridMetrics?.perPage ?? 0
    const shouldRenderUsers = users.length > 0

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
            debouncedFetchUsers.cancel()
        }
    }, [debouncedFetchUsers])

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(search)
        }, 500)
        return () => clearTimeout(handler)
    }, [search])

    useLayoutEffect(() => {
        const syncLayout = () => {
            setPt(prevPt => {
                const nextPt = getPT()
                return prevPt === nextPt ? prevPt : nextPt
            })
            measureGrid()
            calculateIndicator(SORT_FIELDS.indexOf(sorting[0].id))
        }

        syncLayout()

        const debouncedSyncLayout = debounce(syncLayout, 120)
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => debouncedSyncLayout())

        if (observer) {
            ;[containerRef.current, headerRef.current, userPageRef.current].forEach(element => {
                if (element) observer.observe(element)
            })
        }

        window.addEventListener('resize', debouncedSyncLayout)

        return () => {
            debouncedSyncLayout.cancel()
            observer?.disconnect()
            window.removeEventListener('resize', debouncedSyncLayout)
        }
    }, [calculateIndicator, getPT, measureGrid, sorting])

    useEffect(() => {
        queryParamsRef.current = {
            perPage,
            sorting,
            search: debouncedSearch,
        }
    }, [debouncedSearch, perPage, sorting])

    useEffect(() => {
        if (!perPage) return

        const nextQueryKey = queryKeyRef.current + 1
        queryKeyRef.current = nextQueryKey
        nextPagePendingRef.current = false
        animationsEnabledRef.current = false
        scrollDirectionRef.current = 'down'
        lastScrollTopRef.current = 0
        clearInitialShimmerTimers()
        setIsInitialShimmerVisible(true)
        setIsInitialShimmerFading(false)

        setPage(1)
        setMaxPages(1)
        setUsers([])
        setLoading(true)
        setIsFetchingMore(false)
        setHasLoadMoreError(false)

        debouncedFetchUsers(1, perPage, sorting, debouncedSearch, 'replace', nextQueryKey)
    }, [clearInitialShimmerTimers, sorting, debouncedSearch, debouncedFetchUsers, perPage])

    useEffect(() => {
        if (page === 1) return

        const currentQuery = queryParamsRef.current
        if (!currentQuery.perPage) return

        fetchUsers(page, currentQuery.perPage, currentQuery.sorting, currentQuery.search, 'append', queryKeyRef.current)
    }, [page, fetchUsers])

    useEffect(() => {
        return () => {
            clearInitialShimmerTimers()
        }
    }, [clearInitialShimmerTimers])

    useEffect(() => {
        if (loading) return

        if (!shouldRenderUsers) {
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
    }, [INITIAL_SHIMMER_FADE_MS, clearInitialShimmerTimers, isInitialShimmerFading, isInitialShimmerVisible, loading, shouldRenderUsers])

    useLayoutEffect(() => {
        const activeIndex = SORT_FIELDS.indexOf(sorting[0].id)
        const timer = setTimeout(() => calculateIndicator(activeIndex), 0)
        return () => clearTimeout(timer)
    }, [calculateIndicator, sorting])

    useEffect(() => {
        const root = containerRef.current
        const target = loadMoreRef.current

        if (!root || !target || loading || isFetchingMore || hasLoadMoreError || page >= maxPages) return

        const observer = new IntersectionObserver(
            entries => {
                const entry = entries[0]
                if (!entry?.isIntersecting || nextPagePendingRef.current) return

                nextPagePendingRef.current = true
                setPage(prevPage => {
                    if (prevPage >= maxPages) {
                        nextPagePendingRef.current = false
                        return prevPage
                    }

                    return prevPage + 1
                })
            },
            {
                root,
                rootMargin: `0px 0px ${effectiveGridMetrics.prefetchOffsetPx}px 0px`,
                threshold: 0.1,
            },
        )

        observer.observe(target)
        return () => observer.disconnect()
    }, [effectiveGridMetrics.prefetchOffsetPx, hasLoadMoreError, isFetchingMore, loading, maxPages, page])

    const handleSort = useCallback((field: string) => {
        setPage(1)
        setSorting(prev => (prev[0].id === field ? [{ id: field as any, desc: !prev[0].desc }] : [{ id: field as any, desc: true }]))
    }, [])

    const getSortIcon = useCallback(
        (field: string) => {
            if (sorting[0].id !== (field as any)) return null
            return sorting[0].desc ? <MdKeyboardArrowDown className={s.sortIcon} /> : <MdKeyboardArrowUp className={s.sortIcon} />
        },
        [sorting],
    )

    const defaultBackground = useMemo(
        () => ({
            display: 'flex',
            alignItems: 'stretch',
            padding: `${pt}px 40px 12px 40px`,
            backgroundImage: 'linear-gradient(180deg, rgba(38, 41, 53, 0.67) 0%, #2C303F 100%)',
            backgroundColor: '#1D202B',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center center',
            backgroundSize: 'cover',
        }),
        [pt],
    )

    const [bannerUser, setBannerUser] = useState<UserInterface | null>(null)

    useEffect(() => {
        let cancelled = false
        const usersWithBanner = users.filter(u => u.bannerHash)

        const loadBanner = (urls: string[], onSuccess: (url: string) => void, onError: () => void) => {
            const tryLoad = (idx: number) => {
                if (cancelled) return
                if (idx >= urls.length) {
                    onError()
                    return
                }

                const candidate = urls[idx]
                const img = new window.Image()
                img.onload = () => {
                    if (!cancelled) onSuccess(candidate)
                }
                img.onerror = () => {
                    tryLoad(idx + 1)
                }
                img.src = candidate
            }

            tryLoad(0)
        }

        const checkBanner = (list: UserInterface[], idx = 0) => {
            if (idx >= list.length) {
                if (!cancelled) setBannerUser(null)
                return
            }

            const media = getBannerMediaUrls({
                hash: list[idx].bannerHash,
                ext: list[idx].bannerType,
            })

            if (!media?.src) {
                checkBanner(list, idx + 1)
                return
            }

            loadBanner(
                [media.src],
                () => setBannerUser(list[idx]),
                () => checkBanner(list, idx + 1),
            )
        }

        if (usersWithBanner.length) {
            checkBanner(usersWithBanner)
        } else {
            setBannerUser(null)
        }

        return () => {
            cancelled = true
        }
    }, [users])

    return (
        <PageLayout title={t('users.pageTitle')}>
            <Scrollbar
                className={s.containerFix}
                classNameInner={cn(s.containerFixInner, loading && s.containerFixInnerLocked)}
                ref={containerRef}
                onScroll={event => {
                    const nextScrollTop = event.currentTarget.scrollTop
                    animationsEnabledRef.current = true
                    if (nextScrollTop > lastScrollTopRef.current) {
                        scrollDirectionRef.current = 'down'
                    } else if (nextScrollTop < lastScrollTopRef.current) {
                        scrollDirectionRef.current = 'up'
                    }
                    lastScrollTopRef.current = nextScrollTop
                }}
            >
                <div
                    ref={headerRef}
                    style={defaultBackground}
                    className={s.headerSection}
                    onMouseEnter={() => setIsHeaderHovered(true)}
                    onMouseLeave={() => setIsHeaderHovered(false)}
                >
                    {bannerUser && (
                        <>
                            <Banner
                                className={s.headerBannerImage}
                                hash={bannerUser.bannerHash}
                                ext={bannerUser.bannerType}
                                sizes="100vw"
                                alt=""
                                allowAnimate={isHeaderHovered}
                            />
                            <div className={s.headerBannerGradient} />
                        </>
                    )}
                    <div className={s.topSection}>
                        <h1 className={s.title}>{t('users.title')}</h1>
                        <div className={s.searchContainer} onClick={() => inputRef.current?.focus()}>
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder={t('users.searchPlaceholder')}
                                value={search}
                                onChange={e => {
                                    setSearch(e.target.value)
                                }}
                                className={s.searchInput}
                            />
                            <div className={s.searchIconWrapper}>
                                <MdSearch className={s.searchIcon} />
                            </div>
                        </div>
                    </div>
                    <div className={s.sortOptions}>
                        {SORT_FIELDS.map((field, idx) => (
                            <div
                                key={field}
                                ref={setSortRef(idx)}
                                className={cn(s.sortOption, sorting[0].id === field && s.active)}
                                onClick={() => handleSort(field)}
                            >
                                {
                                    {
                                        lastOnline: t('users.sort.lastOnline'),
                                        createdAt: t('users.sort.createdAt'),
                                        username: t('users.sort.username'),
                                        level: t('users.sort.level'),
                                    }[field]
                                }{' '}
                                {getSortIcon(field)}
                            </div>
                        ))}
                        <div className={s.indicator} style={{ left: `${indicatorStyle.left}px`, width: `${indicatorStyle.width}px` }} />
                    </div>
                </div>
                <div ref={userPageRef} className={s.userPage}>
                    {shouldRenderUsers ? (
                        <>
                            <div className={s.initialContentShell}>
                                <div className={s.userGrid}>
                                    {users.map((user, index) => (
                                        <UserCardV2
                                            key={user.id}
                                            user={user}
                                            onClick={openProfile}
                                            animationsEnabledRef={animationsEnabledRef}
                                            scrollDirectionRef={scrollDirectionRef}
                                            eagerVisible={index < effectiveGridMetrics.visibleCount}
                                        />
                                    ))}
                                </div>
                                {isInitialShimmerVisible && (
                                    <div className={cn(s.initialShimmerOverlay, isInitialShimmerFading && s.initialShimmerOverlayHidden)}>
                                        <UsersShimmer count={effectiveGridMetrics.visibleCount} />
                                    </div>
                                )}
                            </div>
                            <div ref={loadMoreRef} className={s.loadMoreSentinel} aria-hidden="true" />
                            {maxPages > 1 && (
                                <div className={s.paginationStatus}>
                                    <span>
                                        {page} / {maxPages}
                                    </span>
                                </div>
                            )}
                            {isFetchingMore && (
                                <div className={s.loadMoreShimmer}>
                                    <UsersShimmer count={effectiveGridMetrics.columns} />
                                </div>
                            )}
                        </>
                    ) : loading ? (
                        <UsersShimmer count={effectiveGridMetrics.visibleCount} />
                    ) : (
                        !loading && <div className={s.noResults}>{t('users.noResults')}</div>
                    )}
                </div>
            </Scrollbar>
        </PageLayout>
    )
}
