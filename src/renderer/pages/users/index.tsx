import Layout from '../../components/layout'
import * as styles from './users.module.scss'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import { useEffect, useState, useCallback } from 'react'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import apolloClient from '../../api/apolloClient'
import { FaSortUp, FaSortDown } from 'react-icons/fa'
import debounce from 'lodash.debounce'
import { MdAllOut, MdHourglassEmpty, MdAccessTime } from 'react-icons/md'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'
import { motion } from 'framer-motion'
import config from '../../api/config'
import TooltipButton from '../../components/tooltip_button'
import { timeAgo } from '../../utils/utils'
import toast from '../../components/toast'
import { useUserProfileModal } from '../../context/UserProfileModalContext'
import { getStatusColor, getStatusTooltip } from '../../utils/userStatus'

export default function UsersPage() {
    const [loading, setLoading] = useState(true)
    const [users, setUsers] = useState<UserInterface[]>([])
    const [page, setPage] = useState(1)
    const [maxPages, setMaxPages] = useState(1)
    const [sorting, setSorting] = useState([{ id: 'lastOnline', desc: true }])
    const [search, setSearch] = useState('')

    const { openUserProfile } = useUserProfileModal()

    const loadingText = 'Загрузка...'.split('')
    const containerVariants = {
        animate: {
            transition: { staggerChildren: 0.1 },
        },
    }
    const letterVariants = {
        initial: { y: 0 },
        animate: {
            y: [0, -10, 0],
            transition: {
                y: {
                    repeat: Infinity,
                    repeatType: 'loop',
                    duration: 1,
                    ease: 'easeInOut',
                },
            },
        },
    }

    const defaultBackground = {
        background: `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)`,
        backgroundSize: 'cover',
    }
    const [backgroundStyle, setBackgroundStyle] = useState(defaultBackground)

    const debouncedFetchUsers = useCallback(
        debounce((page: number, perPage: number, sorting: any, search: string) => {
            setLoading(true)
            apolloClient
                .query({
                    query: GetAllUsersQuery,
                    variables: { perPage, page, sorting, search },
                    fetchPolicy: 'no-cache',
                })
                .then((result) => {
                    if (result.data) {
                        const data = result.data.getUsersWithPagination
                        let filteredUsers = data.users.filter(
                            (user: UserInterface) =>
                                user.lastOnline && Number(user.lastOnline) > 0,
                        )

                        if (sorting[0].id === 'lastOnline') {
                            const sortDirection = sorting[0].desc ? 'desc' : 'asc'

                            const onlineUsers = filteredUsers.filter(
                                (user: UserInterface) => user.status === 'online',
                            )
                            const offlineUsers = filteredUsers.filter(
                                (user: UserInterface) => user.status !== 'online',
                            )

                            const sortFunction = (
                                a: UserInterface,
                                b: UserInterface,
                            ) => {
                                if (sortDirection === 'desc') {
                                    return (
                                        Number(b.lastOnline) - Number(a.lastOnline)
                                    )
                                } else {
                                    return (
                                        Number(a.lastOnline) - Number(b.lastOnline)
                                    )
                                }
                            }

                            onlineUsers.sort(sortFunction)
                            offlineUsers.sort(sortFunction)

                            if (sortDirection === 'desc') {
                                filteredUsers = [...onlineUsers, ...offlineUsers]
                            } else {
                                filteredUsers = [...offlineUsers, ...onlineUsers]
                            }
                        } else {
                        }

                        setUsers(filteredUsers)
                        setMaxPages(data.totalPages)
                    }
                    setLoading(false)
                })
                .catch((e) => {
                    console.error(e)
                    toast.custom(
                        'error',
                        'Ошибка',
                        'Произошла ошибка при получении пользователей!',
                    )
                    setLoading(false)
                })
        }, 300),
        [],
    )

    useEffect(() => {
        debouncedFetchUsers(page, 51, sorting, search)
    }, [sorting, page, search, debouncedFetchUsers])

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= maxPages) {
            setPage(newPage)
        }
    }

    const handleSort = (field: string) => {
        setPage(1)
        setSorting((prevSorting) => {
            if (prevSorting.length > 0 && prevSorting[0].id === field) {
                return [{ id: field, desc: !prevSorting[0].desc }]
            } else {
                return [{ id: field, desc: true }]
            }
        })
    }

    const getSortIcon = (field: string) => {
        if (sorting.length === 0 || sorting[0].id !== field) return null
        return sorting[0].desc ? (
            <FaSortDown className={styles.sortIcon} />
        ) : (
            <FaSortUp className={styles.sortIcon} />
        )
    }

    const isFieldSorted = (field: string) =>
        sorting.length > 0 && sorting[0].id === field

    const renderPagination = () => {
        const pages = []
        const maxPageButtons = 2
        let startPage = Math.max(1, page - Math.floor(maxPageButtons / 2))
        let endPage = startPage + maxPageButtons - 1

        if (endPage > maxPages) {
            endPage = maxPages
            startPage = Math.max(1, endPage - maxPageButtons + 1)
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(
                <button
                    key={i}
                    className={`${styles.paginationButton} ${i === page ? styles.active : ''}`}
                    onClick={() => handlePageChange(i)}
                >
                    {i}
                </button>,
            )
        }

        return (
            <div className={styles.pagination}>
                <button
                    className={styles.paginationButtonLR}
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1}
                >
                    Назад
                </button>
                {startPage > 1 && (
                    <>
                        <button
                            className={styles.paginationButton}
                            onClick={() => handlePageChange(1)}
                        >
                            1
                        </button>
                        {startPage > 2 && (
                            <span className={styles.ellipsis}>...</span>
                        )}
                    </>
                )}
                {pages}
                {endPage < maxPages && (
                    <>
                        {endPage < maxPages - 1 && (
                            <span className={styles.ellipsis}>...</span>
                        )}
                        <button
                            className={styles.paginationButton}
                            onClick={() => handlePageChange(maxPages)}
                        >
                            {maxPages}
                        </button>
                    </>
                )}
                <button
                    className={styles.paginationButtonLR}
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page === maxPages}
                >
                    Вперед
                </button>
            </div>
        )
    }

    useEffect(() => {
        const usersWithBanner = users.filter((user) => user.bannerHash)
        const checkBannerAvailability = (userList: UserInterface[], index = 0) => {
            if (index >= userList.length) {
                setBackgroundStyle(defaultBackground)
                return
            }
            const img = new Image()
            img.src = `${config.S3_URL}/banners/${userList[index].bannerHash}.${userList[index].bannerType}`
            img.onload = () => {
                setBackgroundStyle({
                    background: `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%), url(${config.S3_URL}/banners/${userList[index].bannerHash}.${userList[index].bannerType}) no-repeat center center`,
                    backgroundSize: 'cover',
                })
            }
            img.onerror = () => checkBannerAvailability(userList, index + 1)
        }
        if (usersWithBanner.length > 0) {
            checkBannerAvailability(usersWithBanner)
        } else {
            setBackgroundStyle(defaultBackground)
        }
    }, [users])

    return (
        <Layout title="Пользователи">
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div
                            className={styles.searchContainer}
                            style={backgroundStyle}
                        >
                            <div className={styles.titlePage}>Пользователи</div>
                            <div className={styles.BoxContainer}>
                                <div className={styles.searchBoxContainer}>
                                    <SearchImg />
                                    <input
                                        className={styles.searchInput}
                                        type="text"
                                        placeholder="Поиск..."
                                        value={search}
                                        onChange={(e) => {
                                            setSearch(e.target.value)
                                            setPage(1)
                                        }}
                                    />
                                </div>
                                <div className={styles.userNav}>
                                    <div className={styles.userNavContainer}>
                                        <button
                                            className={`${styles.userNavButton} ${isFieldSorted('lastOnline') ? styles.activeSort : ''}`}
                                            onClick={() => handleSort('lastOnline')}
                                        >
                                            <MdAccessTime /> Последняя активность{' '}
                                            {getSortIcon('lastOnline')}
                                        </button>
                                        <button
                                            className={`${styles.userNavButton} ${isFieldSorted('createdAt') ? styles.activeSort : ''}`}
                                            onClick={() => handleSort('createdAt')}
                                        >
                                            <MdHourglassEmpty /> Дата регистрации{' '}
                                            {getSortIcon('createdAt')}
                                        </button>
                                        <button
                                            className={`${styles.userNavButton} ${isFieldSorted('username') ? styles.activeSort : ''}`}
                                            onClick={() => handleSort('username')}
                                        >
                                            <MdAllOut /> Имя пользователя{' '}
                                            {getSortIcon('username')}
                                        </button>
                                    </div>
                                    {users.length > 0 && renderPagination()}
                                </div>
                            </div>
                        </div>
                        <div className={globalStyles.container30x15}>
                            {loading ? (
                                <div className={styles.loading}>
                                    <motion.div
                                        variants={containerVariants}
                                        initial="initial"
                                        animate="animate"
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        {loadingText.map((char, index) => (
                                            <motion.span
                                                key={index}
                                                variants={letterVariants}
                                                style={{
                                                    display: 'inline-block',
                                                    marginRight: '2px',
                                                }}
                                            >
                                                {char}
                                            </motion.span>
                                        ))}
                                    </motion.div>
                                </div>
                            ) : (
                                <div className={styles.userPage}>
                                    {users.length > 0 ? (
                                        <div className={styles.userGrid}>
                                            {users.map((user) => {
                                                const statusColor =
                                                    getStatusColor(user)
                                                const statusTooltip =
                                                    getStatusTooltip(user)
                                                return (
                                                    <button
                                                        key={user.id}
                                                        className={styles.userCard}
                                                        onClick={() =>
                                                            openUserProfile(
                                                                user.username,
                                                            )
                                                        }
                                                        style={{
                                                            background:
                                                                user.bannerHash
                                                                    ? `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%), url(${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}) no-repeat center center`
                                                                    : `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)`,
                                                            backgroundSize: 'cover',
                                                        }}
                                                    >
                                                        <div
                                                            className={
                                                                styles.cardHeader
                                                            }
                                                        >
                                                            <div
                                                                style={{
                                                                    position:
                                                                        'relative',
                                                                }}
                                                            >
                                                                <img
                                                                    className={
                                                                        styles.userAvatar
                                                                    }
                                                                    src={`${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`}
                                                                    alt={
                                                                        user.username
                                                                    }
                                                                    onError={(e) => {
                                                                        ;(
                                                                            e.currentTarget as HTMLImageElement
                                                                        ).src =
                                                                            './static/assets/images/undef.png'
                                                                    }}
                                                                />
                                                                <TooltipButton
                                                                    tooltipText={
                                                                        statusTooltip
                                                                    }
                                                                    side="top"
                                                                    className={
                                                                        styles.statusCircle
                                                                    }
                                                                    style={{
                                                                        backgroundColor:
                                                                            statusColor,
                                                                    }}
                                                                >
                                                                    <></>
                                                                </TooltipButton>
                                                            </div>
                                                            <div
                                                                className={
                                                                    styles.userInfo
                                                                }
                                                            >
                                                                <span
                                                                    className={
                                                                        styles.username
                                                                    }
                                                                >
                                                                    {user.username}
                                                                </span>
                                                                <span
                                                                    className={
                                                                        styles.userStatus
                                                                    }
                                                                >
                                                                    {user.status ===
                                                                    'online'
                                                                        ? 'Сейчас в сети'
                                                                        : user.lastOnline
                                                                          ? `Был в сети: ${timeAgo(Number(user.lastOnline))}`
                                                                          : ''}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div
                                                            className={
                                                                styles.userBadges
                                                            }
                                                        >
                                                            {user.badges.length >
                                                                0 &&
                                                                user.badges
                                                                    .slice()
                                                                    .sort(
                                                                        (a, b) =>
                                                                            b.level -
                                                                            a.level,
                                                                    )
                                                                    .map(
                                                                        (_badge) => (
                                                                            <TooltipButton
                                                                                key={`${_badge.type}-${_badge.level}`}
                                                                                tooltipText={
                                                                                    _badge.name
                                                                                }
                                                                                side="bottom"
                                                                            >
                                                                                <div
                                                                                    className={`${styles.badge} ${styles[`badgeLevel${_badge.level}`]}`}
                                                                                >
                                                                                    <img
                                                                                        src={`static/assets/badges/${_badge.type}.svg`}
                                                                                        alt={
                                                                                            _badge.name
                                                                                        }
                                                                                    />
                                                                                </div>
                                                                            </TooltipButton>
                                                                        ),
                                                                    )}
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className={styles.noResults}>
                                            Нет результатов
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}
