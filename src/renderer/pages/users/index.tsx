import PageLayout from '../PageLayout'
import * as s from './users.module.scss'
import { useLayoutEffect, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import apolloClient from '../../api/apolloClient'
import debounce from 'lodash.debounce'
import { MdKeyboardArrowDown, MdKeyboardArrowLeft, MdKeyboardArrowRight, MdKeyboardArrowUp, MdSearch } from 'react-icons/md'
import config from '@common/appConfig'
import toast from '../../components/toast'
import UserCardV2 from '../../components/userCardV2'
import Scrollbar from '../../components/PSUI/Scrollbar'
import { useTranslation } from 'react-i18next'

const PER_PAGE = 51
const SORT_FIELDS = ['lastOnline', 'createdAt', 'username', 'level'] as const

type SortState = { id: (typeof SORT_FIELDS)[number]; desc: boolean }[]

const SAFE_LEVEL = {
    totalPoints: 0,
    currentLevel: 1,
    progressInCurrentLevel: 0,
    currentLevelThreshold: 100,
}

function normalizeUser(u: any): UserInterface {
    return {
        ...u,
        badges: Array.isArray(u?.badges) ? u.badges : [],
        levelInfo: u?.levelInfo && typeof u.levelInfo === 'object' ? u.levelInfo : SAFE_LEVEL,
    }
}

export default function UsersPage() {
    const [loading, setLoading] = useState(true)
    const [users, setUsers] = useState<UserInterface[]>([])
    const [page, setPage] = useState(1)
    const [maxPages, setMaxPages] = useState(1)
    const [sorting, setSorting] = useState<SortState>([{ id: 'lastOnline', desc: true }])
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const sortRefs = useRef<(HTMLDivElement | null)[]>(new Array(4).fill(null))
    const nav = useNavigate()
    const { t } = useTranslation()

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

    const calculateIndicator = useCallback((index: number) => {
        const el = sortRefs.current[index]
        if (el && el.parentElement) {
            const rect = el.getBoundingClientRect()
            const containerRect = el.parentElement.getBoundingClientRect()
            setIndicatorStyle({
                left: rect.left - containerRect.left,
                width: rect.width,
            })
        }
    }, [])

    const processUsers = useCallback((rawUsers: UserInterface[], sortingState: SortState): UserInterface[] => {
        const id = sortingState[0].id
        const desc = sortingState[0].desc
        const arr = rawUsers.map(normalizeUser)

        if (id === 'lastOnline') {
            return [...arr].sort((a, b) => {
                const aOnline = a.status === 'online'
                const bOnline = b.status === 'online'
                if (aOnline !== bOnline) return aOnline ? -1 : 1
                const aT = a.lastOnline ? Number(a.lastOnline) : 0
                const bT = b.lastOnline ? Number(b.lastOnline) : 0
                if (aT === bT) return 0
                return desc ? bT - aT : aT - bT
            })
        }

        if (id === 'createdAt') {
            return [...arr].sort((a, b) => {
                const aT = a.createdAt ? Number(a.createdAt) : 0
                const bT = b.createdAt ? Number(b.createdAt) : 0
                return desc ? bT - aT : aT - bT
            })
        }

        if (id === 'username') {
            return [...arr].sort((a, b) => {
                const r = (a.username || '').localeCompare(b.username || '', undefined, { sensitivity: 'base' })
                return desc ? -r : r
            })
        }

        if (id === 'level') {
            return [...arr].sort((a, b) => {
                const aPts = a.levelInfo?.totalPoints ?? 0
                const bPts = b.levelInfo?.totalPoints ?? 0
                return desc ? bPts - aPts : aPts - bPts
            })
        }

        return arr
    }, [])

    const fetchUsers = useCallback(
        (page_: number, perPage_: number, sorting_: SortState, search_: string) => {
            setLoading(true)
            apolloClient
                .query({
                    query: GetAllUsersQuery,
                    variables: { perPage: perPage_, page: page_, sorting: sorting_, search: search_ },
                    fetchPolicy: 'no-cache',
                })
                .then(result => {
                    const data: any = result.data || {}
                    const payload = data.getUsersWithPagination || null
                    if (payload) {
                        const raw: UserInterface[] = Array.isArray(payload.users) ? payload.users : []
                        const totalPages: number = payload.totalPages || 1
                        setUsers(processUsers(raw, sorting_))
                        setMaxPages(totalPages)
                    } else {
                        setUsers([])
                        setMaxPages(1)
                    }
                    setLoading(false)
                })
                .catch(e => {
                    console.error(e)
                    toast.custom('error', t('common.errorTitle'), t('users.fetchError'))
                    setLoading(false)
                })
        },
        [processUsers, t],
    )

    const debouncedFetchUsers = useMemo(() => debounce(fetchUsers, 300), [fetchUsers])

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

    useEffect(() => {
        debouncedFetchUsers(page, PER_PAGE, sorting, debouncedSearch)
    }, [sorting, page, debouncedSearch, debouncedFetchUsers])

    useLayoutEffect(() => {
        const activeIndex = SORT_FIELDS.indexOf(sorting[0].id)
        const timer = setTimeout(() => calculateIndicator(activeIndex), 0)
        return () => clearTimeout(timer)
    }, [calculateIndicator, sorting, users])

    useEffect(() => {
        const handler = () => {
            const idx = SORT_FIELDS.indexOf(sorting[0].id)
            calculateIndicator(idx)
        }
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [calculateIndicator, sorting])

    const getPT = useCallback(() => Math.round(window.innerHeight * 0.15), [])
    const [pt, setPt] = useState(getPT())

    useEffect(() => {
        const onResize = () => setPt(getPT())
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [getPT])

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
            backgroundImage: 'linear-gradient(180deg, rgba(38, 41, 53, 0.67) 0%, #2C303F 100%), url(image.png)',
            backgroundColor: '#1D202B',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center center',
            backgroundSize: 'cover',
        }),
        [pt],
    )

    const [backgroundStyle, setBackgroundStyle] = useState(defaultBackground)

    useEffect(() => {
        const usersWithBanner = users.filter(u => u.bannerHash)
        const checkBanner = (list: UserInterface[], idx = 0) => {
            if (idx >= list.length) {
                setBackgroundStyle(defaultBackground)
                return
            }
            const img = new Image()
            const url = `${config.S3_URL}/banners/${list[idx].bannerHash}.${list[idx].bannerType}`
            img.src = url
            img.onload = () =>
                setBackgroundStyle({
                    ...defaultBackground,
                    backgroundImage: `linear-gradient(180deg, rgba(38, 41, 53, 0.67) 0%, #2C303F 100%), url(${url})`,
                })
            img.onerror = () => checkBanner(list, idx + 1)
        }
        usersWithBanner.length ? checkBanner(usersWithBanner) : setBackgroundStyle(defaultBackground)
    }, [users, defaultBackground])

    const handlePageChange = useCallback((newPage: number) => {
        setPage(newPage)
        setTimeout(() => {
            containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        }, 0)
    }, [])

    const pagination = useMemo(() => {
        if (maxPages <= 1) return null

        const maxVisibleButtons = 5
        let startPage = Math.max(1, page - Math.floor(maxVisibleButtons / 2))
        let endPage = Math.min(maxPages, startPage + maxVisibleButtons - 1)

        if (endPage - startPage + 1 < maxVisibleButtons) {
            startPage = Math.max(1, endPage - maxVisibleButtons + 1)
        }

        return (
            <div className={s.paginationContainer}>
                <button onClick={() => handlePageChange(page - 1)} disabled={page === 1} className={s.paginationNavButton}>
                    <MdKeyboardArrowLeft />
                </button>
                {startPage > 1 && (
                    <>
                        <button onClick={() => handlePageChange(1)} className={s.paginationPageButton}>
                            1
                        </button>
                        {startPage > 2 && <span className={s.paginationEllipsis}>...</span>}
                    </>
                )}
                {Array.from({ length: endPage - startPage + 1 }).map((_, i) => {
                    const pageNum = startPage + i
                    return (
                        <button
                            key={pageNum}
                            onClick={() => handlePageChange(pageNum)}
                            className={`${s.paginationPageButton} ${pageNum === page ? s.activePage : ''}`}
                        >
                            {pageNum}
                        </button>
                    )
                })}
                {endPage < maxPages && (
                    <>
                        {endPage < maxPages - 1 && <span className={s.paginationEllipsis}>...</span>}
                        <button onClick={() => handlePageChange(maxPages)} className={s.paginationPageButton}>
                            {maxPages}
                        </button>
                    </>
                )}
                <button onClick={() => handlePageChange(page + 1)} disabled={page === maxPages} className={s.paginationNavButton}>
                    <MdKeyboardArrowRight />
                </button>
            </div>
        )
    }, [handlePageChange, maxPages, page])

    return (
        <PageLayout title={t('users.pageTitle')}>
            <Scrollbar className={s.containerFix} classNameInner={s.containerFixInner} ref={containerRef}>
                <div style={backgroundStyle} className={s.headerSection}>
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
                                    setPage(1)
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
                                className={`${s.sortOption} ${sorting[0].id === field ? s.active : ''}`}
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
                <div className={s.userPage}>
                    {users.length > 0 ? (
                        <div className={s.userGrid}>
                            {users.map(user => (
                                <UserCardV2 key={user.id} user={user} onClick={openProfile} />
                            ))}
                        </div>
                    ) : (
                        !loading && <div className={s.noResults}>{t('users.noResults')}</div>
                    )}
                </div>
                {pagination}
            </Scrollbar>
        </PageLayout>
    )
}

