import Layout from '../../components/layout'
import * as s from './users.module.scss'
import * as styles from '../../../../static/styles/page/index.module.scss'
import { useLayoutEffect, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import apolloClient from '../../api/apolloClient'
import debounce from 'lodash.debounce'
import { MdKeyboardArrowDown, MdKeyboardArrowLeft, MdKeyboardArrowRight, MdKeyboardArrowUp, MdSearch } from 'react-icons/md'
import config from '../../api/config'
import toast from '../../components/toast'
import { useUserProfileModal } from '../../context/UserProfileModalContext'
import UserCardV2 from '../../components/userCardV2'
import Scrollbar from '../../components/PSUI/Scrollbar'

const PER_PAGE = 51
const SORT_FIELDS = ['lastOnline', 'createdAt', 'username', 'level'] as const

export default function UsersPage() {
    const [loading, setLoading] = useState(true)
    const [users, setUsers] = useState<UserInterface[]>([])
    const [page, setPage] = useState(1)
    const [maxPages, setMaxPages] = useState(1)
    const [sorting, setSorting] = useState([{ id: 'lastOnline', desc: true }])
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 })

    const inputRef = useRef<HTMLInputElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const sortRefs = useRef<(HTMLDivElement | null)[]>(new Array(4).fill(null))
    const { openUserProfile } = useUserProfileModal()

    const setSortRef =
        (idx: number) =>
        (el: HTMLDivElement | null): void => {
            sortRefs.current[idx] = el
        }

    const calculateIndicator = (index: number) => {
        const el = sortRefs.current[index]
        if (el && el.parentElement) {
            const rect = el.getBoundingClientRect()
            const containerRect = el.parentElement.getBoundingClientRect()
            setIndicatorStyle({
                left: rect.left - containerRect.left,
                width: rect.width,
            })
        }
    }

    const processUsers = (rawUsers: UserInterface[]): UserInterface[] => {
        let filtered = rawUsers.filter(u => u.lastOnline && Number(u.lastOnline) > 0)
        if (sorting[0].id === 'lastOnline') {
            const desc = sorting[0].desc
            const onlineUsers = filtered.filter(u => u.status === 'online')
            const offlineUsers = filtered.filter(u => u.status !== 'online')
            const sortFn = (a: UserInterface, b: UserInterface) =>
                desc ? Number(b.lastOnline) - Number(a.lastOnline) : Number(a.lastOnline) - Number(b.lastOnline)
            onlineUsers.sort(sortFn)
            offlineUsers.sort(sortFn)
            filtered = desc ? [...onlineUsers, ...offlineUsers] : [...offlineUsers, ...onlineUsers]
        }
        return filtered
    }

    const fetchUsers = useCallback(
        (page_: number, perPage_: number, sorting_: any, search_: string) => {
            setLoading(true)
            apolloClient
                .query({
                    query: GetAllUsersQuery,
                    variables: { perPage: perPage_, page: page_, sorting: sorting_, search: search_ },
                    fetchPolicy: 'no-cache',
                })
                .then(result => {
                    if (result.data) {
                        const { users: raw, totalPages } = result.data.getUsersWithPagination
                        setUsers(processUsers(raw))
                        setMaxPages(totalPages)
                    }
                    setLoading(false)
                })
                .catch(e => {
                    console.error(e)
                    toast.custom('error', 'Ошибка', 'Произошла ошибка при получении пользователей!')
                    setLoading(false)
                })
        },
        [sorting],
    )

    const debouncedFetchUsers = useMemo(() => debounce(fetchUsers, 300), [fetchUsers])

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
        const activeIndex = SORT_FIELDS.indexOf(sorting[0].id as (typeof SORT_FIELDS)[number])
        const timer = setTimeout(() => calculateIndicator(activeIndex), 0)
        return () => clearTimeout(timer)
    }, [sorting, users])

    useEffect(() => {
        const handler = () => {
            const idx = SORT_FIELDS.indexOf(sorting[0].id as (typeof SORT_FIELDS)[number])
            calculateIndicator(idx)
        }
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [sorting])

    const handleSort = (field: string) => {
        setPage(1)
        setSorting(prev => (prev[0].id === field ? [{ id: field, desc: !prev[0].desc }] : [{ id: field, desc: true }]))
    }

    const getSortIcon = (field: string) => {
        if (sorting[0].id !== field) return null
        return sorting[0].desc ? <MdKeyboardArrowDown className={s.sortIcon} /> : <MdKeyboardArrowUp className={s.sortIcon} />
    }

    const defaultBackground = useMemo(
        () => ({
            alignItems: 'stretch',
            display: 'flex',
            padding: '15vh 40px 12px 40px',
            background: 'linear-gradient(180deg, rgba(38, 41, 53, 0.67) 0%, #2C303F 100%), url(image.png), #1D202B',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center center',
            backgroundSize: 'cover',
        }),
        [],
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
                    background: `linear-gradient(180deg, rgba(38, 41, 53, 0.67) 0%, #2C303F 100%), url(${url}), #1D202B`,
                })
            img.onerror = () => checkBanner(list, idx + 1)
        }
        usersWithBanner.length ? checkBanner(usersWithBanner) : setBackgroundStyle(defaultBackground)
    }, [users, defaultBackground])

    const renderPagination = () => {
        if (maxPages <= 1) return null

        const handlePageChange = (newPage: number) => {
            setPage(newPage)
            setTimeout(() => {
                containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
            }, 0)
        }

        const pages = []
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
    }

    return (
        <Layout title="Пользователи">
            <div className={styles.page}>
                <div className={styles.container}>
                    <div className={styles.main_container}>
                        <Scrollbar className={s.containerFix} classNameInner={s.containerFixInner} ref={containerRef}>
                            <div style={backgroundStyle} className={s.headerSection}>
                                <div className={s.topSection}>
                                    <h1 className={s.title}>Пользователи</h1>
                                    <div className={s.searchContainer} onClick={() => inputRef.current?.focus()}>
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            placeholder="найти..."
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
                                                    lastOnline: 'Последняя активность',
                                                    createdAt: 'Дата регистрации',
                                                    username: 'Имя пользователя',
                                                    level: 'Уровень',
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
                                            <UserCardV2 key={user.id} user={user} onClick={openUserProfile} />
                                        ))}
                                    </div>
                                ) : (
                                    !loading && <div className={s.noResults}>Нет результатов</div>
                                )}
                            </div>
                            {renderPagination()}
                        </Scrollbar>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
