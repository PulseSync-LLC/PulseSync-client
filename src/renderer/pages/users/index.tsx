import Layout from '../../components/layout'
import * as s from './users.module.scss'
import * as styles from '../../../../static/styles/page/index.module.scss'
import { useEffect, useState, useCallback } from 'react'
import { useSubscription } from '@apollo/client'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import GetAllUsersSubscription from '../../api/queries/user/getAllUsers.subscription'
import apolloClient from '../../api/apolloClient'
import debounce from 'lodash.debounce'
import { MdAllOut, MdHourglassEmpty, MdAccessTime, MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'
import { motion } from 'framer-motion'
import config from '../../api/config'
import toast from '../../components/toast'
import { useUserProfileModal } from '../../context/UserProfileModalContext'
import UserCard from '../../components/userCard'
import Button from '../../components/button'
import ContainerV2 from '../../components/containerV2'
import Tabs, { TabItem } from '../../components/PSUI/Tabs'
import Scrollbar from '../../components/PSUI/Scrollbar'

export default function UsersPage() {
    const [loading, setLoading] = useState(true)
    const [users, setUsers] = useState<UserInterface[]>([])
    const [page, setPage] = useState(1)
    const [maxPages, setMaxPages] = useState(1)
    const [sorting, setSorting] = useState([{ id: 'lastOnline', desc: true }])
    const [search, setSearch] = useState('')

    const { openUserProfile } = useUserProfileModal()

    const isUserInactive = (lastOnline: string | null) => {
        if (!lastOnline) return false
        const lastDate = new Date(Number(lastOnline))
        const oneWeekAgo = new Date()
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
        return lastDate < oneWeekAgo
    }

    const { data: subData } = useSubscription(GetAllUsersSubscription, {
        variables: { page, perPage: 51, sorting, search },
    })

    const processUsers = (rawUsers: UserInterface[]) => {
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

    useEffect(() => {
        if (subData?.subscribeUsersWithPagination) {
            const { users: raw, totalPages } = subData.subscribeUsersWithPagination
            setUsers(processUsers(raw))
            setMaxPages(totalPages)
            setLoading(false)
        }
    }, [subData, sorting])

    const loadingText = 'Загрузка...'.split('')
    const containerVariants = { animate: { transition: { staggerChildren: 0.1 } } }
    const letterVariants = {
        initial: { y: 0 },
        animate: {
            y: [0, -10, 0],
            transition: { y: { repeat: Infinity, repeatType: 'loop', duration: 1, ease: 'easeInOut' } },
        },
    }

    const tabConfigs: Array<{ title: string; icon: React.ReactNode; field: string }> = [
        { title: 'Последняя активность', icon: <MdAccessTime />, field: 'lastOnline' },
        { title: 'Дата регистрации', icon: <MdHourglassEmpty />, field: 'createdAt' },
        { title: 'Имя пользователя', icon: <MdAllOut />, field: 'username' },
        { title: 'Уровень', icon: <MdAllOut />, field: 'level' }, // или 'По рейтингу' если нужно
    ]

    const activeTab = tabConfigs.find(c => sorting[0].id === c.field)?.title ?? tabConfigs[0].title

    const onTabChange = (title: string) => {
        const cfg = tabConfigs.find(c => c.title === title)
        if (cfg) handleSort(cfg.field)
    }

    type BackgroundStyle = {
        height?: string
        minHeight?: string
        alignItems?: string
        display?: string
        padding?: string
        backgroundImage: string
        backgroundRepeat: string
        backgroundPosition: string
        backgroundSize: string
    }

    const defaultBackground: BackgroundStyle = {
        minHeight: '75px',
        alignItems: 'flex-end',
        display: 'flex',
        padding: '12px 40px',
        backgroundImage: 'linear-gradient(180deg, rgba(35, 39, 55, 0.8) 0%, #232737 100%)',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center center',
        backgroundSize: 'cover',
    }
    const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>(defaultBackground)

    const debouncedFetchUsers = useCallback(
        debounce((page: number, perPage: number, sorting: any, search: string) => {
            setLoading(true)
            apolloClient
                .query({
                    query: GetAllUsersQuery,
                    variables: { perPage, page, sorting, search },
                    fetchPolicy: 'no-cache',
                })
                .then(result => {
                    if (result.data) {
                        const data = result.data.getUsersWithPagination
                        setUsers(processUsers(data.users))
                        setMaxPages(data.totalPages)
                    }
                    setLoading(false)
                })
                .catch(e => {
                    console.error(e)
                    toast.custom('error', 'Ошибка', 'Произошла ошибка при получении пользователей!')
                    setLoading(false)
                })
        }, 300),
        [sorting],
    )

    useEffect(() => {
        debouncedFetchUsers(page, 51, sorting, search)
    }, [sorting, page, search, debouncedFetchUsers])

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= maxPages) setPage(newPage)
    }

    const handleSort = (field: string) => {
        setPage(1)
        setSorting(prev => (prev[0].id === field ? [{ id: field, desc: !prev[0].desc }] : [{ id: field, desc: true }]))
    }

    const getSortIcon = (field: string) => {
        if (sorting[0].id !== field) return null
        return sorting[0].desc ? <MdKeyboardArrowDown className={s.sortIcon} /> : <MdKeyboardArrowUp className={s.sortIcon} />
    }

    const isFieldSorted = (field: string) => sorting[0].id === field

    const renderPagination = () => {
        const pages = []
        const maxButtons = 2
        let start = Math.max(1, page - Math.floor(maxButtons / 2))
        let end = Math.min(maxPages, start + maxButtons - 1)
        if (end - start + 1 < maxButtons) start = Math.max(1, end - maxButtons + 1)

        for (let i = start; i <= end; i++) {
            pages.push(
                <Button key={i} className={`${s.paginationButton} ${i === page ? s.active : ''}`} onClick={() => handlePageChange(i)}>
                    {i}
                </Button>,
            )
        }

        return (
            <div className={s.pagination}>
                <Button className={s.paginationButtonLR} onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
                    Назад
                </Button>
                {start > 1 && (
                    <>
                        <Button className={s.paginationButton} onClick={() => handlePageChange(1)}>
                            1
                        </Button>
                        {start > 2 && <span className={s.ellipsis}>...</span>}
                    </>
                )}
                {pages}
                {end < maxPages && (
                    <>
                        {end < maxPages - 1 && <span className={s.ellipsis}>...</span>}
                        <Button className={s.paginationButton} onClick={() => handlePageChange(maxPages)}>
                            {maxPages}
                        </Button>
                    </>
                )}
                <Button className={s.paginationButtonLR} onClick={() => handlePageChange(page + 1)} disabled={page === maxPages}>
                    Вперед
                </Button>
            </div>
        )
    }

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
                    minHeight: '75px',
                    alignItems: 'flex-end',
                    display: 'flex',
                    padding: '12px 40px',
                    backgroundImage: `linear-gradient(180deg, rgba(35, 39, 55, 0.8) 0%, #232737 100%), url(${url})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'center center',
                    backgroundSize: 'cover',
                })
            img.onerror = () => checkBanner(list, idx + 1)
        }

        usersWithBanner.length ? checkBanner(usersWithBanner) : setBackgroundStyle(defaultBackground)
    }, [users])

    const [isSticky, setIsSticky] = useState(false)
    useEffect(() => {
        const onScroll = () => {
            const nav = document.querySelector(`.${s.userNav}`)
            if (nav) setIsSticky(nav.getBoundingClientRect().top <= 0)
        }
        window.addEventListener('scroll', onScroll)
        return () => window.removeEventListener('scroll', onScroll)
    }, [])

    return (
        <Layout title="Пользователи">
            <div className={styles.page}>
                <div className={styles.container}>
                    <Scrollbar className={s.containerFix} classNameInner={s.containerFixInner}>
                        <div className={styles.main_container}>
                            <ContainerV2 titleName="Пользователи" imageName="users" style={backgroundStyle} />
                            <Tabs
                                active={activeTab}
                                onChange={onTabChange}
                                tabs={tabConfigs.map(({ title, icon }) => ({ title, icon }))}
                                sortDirection={sorting[0].desc ? 'desc' : 'asc'}
                                stickyPos={{ top: '0px' }}
                            />

                            {loading ? (
                                <div className={s.loading}>
                                    <motion.div
                                        variants={containerVariants}
                                        initial="initial"
                                        animate="animate"
                                        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                                    >
                                        {loadingText.map((char, i) => (
                                            <motion.span key={i} variants={letterVariants} style={{ display: 'inline-block', marginRight: '2px' }}>
                                                {char}
                                            </motion.span>
                                        ))}
                                    </motion.div>
                                </div>
                            ) : (
                                <div className={s.userPage}>
                                    {users.length > 0 ? (
                                        <div className={s.userGrid}>
                                            {users.map(user => (
                                                <UserCard key={user.id} user={user} onClick={openUserProfile} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className={s.noResults}>Нет результатов</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </Scrollbar>
                </div>
            </div>
        </Layout>
        // <Layout title="Пользователи">
        //     <div className={globalS.page}>
        //         <div className={globalS.container}>
        //             <div className={globalS.main_container}>
        //                 <div className={globalS.container0x0}>
        //                     <div style={backgroundStyle} className={s.previewImage}></div>
        //                     <div className={s.searchContainer}>
        //                         <div className={s.BoxContainer}>
        //                             <div className={s.titlePage}>Пользователи</div>
        //                             <div className={s.searchBoxContainer}>
        //                                 <SearchImg />
        //                                 <input
        //                                     className={s.searchInput}
        //                                     type="text"
        //                                     placeholder="Поиск..."
        //                                     value={search}
        //                                     onChange={e => {
        //                                         setSearch(e.target.value)
        //                                         setPage(1)
        //                                     }}
        //                                 />
        //                             </div>
        //                         </div>
        //                     </div>
        //                     <div className={`${s.userNav} ${isSticky ? s.sticky : ''}`}>
        //                         <div className={s.userNavContainer}>
        //                             <Button
        //                                 className={`${s.userNavButton} ${isFieldSorted('lastOnline') ? s.activeSort : ''}`}
        //                                 onClick={() => handleSort('lastOnline')}
        //                             >
        //                                 <MdAccessTime /> Последняя активность {getSortIcon('lastOnline')}
        //                             </Button>
        //                             <Button
        //                                 className={`${s.userNavButton} ${isFieldSorted('createdAt') ? s.activeSort : ''}`}
        //                                 onClick={() => handleSort('createdAt')}
        //                             >
        //                                 <MdHourglassEmpty /> Дата регистрации {getSortIcon('createdAt')}
        //                             </Button>
        //                             <Button
        //                                 className={`${s.userNavButton} ${isFieldSorted('username') ? s.activeSort : ''}`}
        //                                 onClick={() => handleSort('username')}
        //                             >
        //                                 <MdAllOut /> Имя пользователя {getSortIcon('username')}
        //                             </Button>
        //                             <Button
        //                                 className={`${s.userNavButton} ${isFieldSorted('level') ? s.activeSort : ''}`}
        //                                 onClick={() => handleSort('level')}
        //                             >
        //                                 <MdAllOut /> level {getSortIcon('level')}
        //                             </Button>
        //                         </div>
        //                         {users.length > 0 && renderPagination()}
        //                     </div>
        //                     <div className={globalS.containerUsesPage}>
        //                         {loading ? (
        //                             <div className={s.loading}>
        //                                 <motion.div
        //                                     variants={containerVariants}
        //                                     initial="initial"
        //                                     animate="animate"
        //                                     style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
        //                                 >
        //                                     {loadingText.map((char, i) => (
        //                                         <motion.span
        //                                             key={i}
        //                                             variants={letterVariants}
        //                                             style={{ display: 'inline-block', marginRight: '2px' }}
        //                                         >
        //                                             {char}
        //                                         </motion.span>
        //                                     ))}
        //                                 </motion.div>
        //                             </div>
        //                         ) : (
        //                             <div className={s.userPage}>
        //                                 {users.length > 0 ? (
        //                                     <div className={s.userGrid}>
        //                                         {users.map(user => (
        //                                             <UserCard key={user.id} user={user} onClick={openUserProfile} />
        //                                         ))}
        //                                     </div>
        //                                 ) : (
        //                                     <div className={s.noResults}>Нет результатов</div>
        //                                 )}
        //                             </div>
        //                         )}
        //                     </div>
        //                 </div>
        //             </div>
        //         </div>
        //     </div>
        // </Layout>
    )
}
