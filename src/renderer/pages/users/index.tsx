import Layout from '../../components/layout'
import * as styles from './users.module.scss'
import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import { useEffect, useState, useCallback } from 'react'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import apolloClient from '../../api/apolloClient'
import toast from 'react-hot-toast-magic'
import { FaSortUp, FaSortDown } from 'react-icons/fa'
import debounce from 'lodash.debounce'
import { MdAllOut, MdHourglassEmpty } from 'react-icons/md'
import SearchImg from './../../../../static/assets/stratis-icons/search.svg'

export default function UsersPage() {
    const [loading, setLoading] = useState(true)
    const [users, setUsers] = useState<UserInterface[]>([])
    const [page, setPage] = useState(1)
    const [maxPages, setMaxPages] = useState(1)
    const [sorting, setSorting] = useState([{ id: 'createdAt', desc: true }])
    const [search, setSearch] = useState('')

    const [backgroundStyle, setBackgroundStyle] = useState({
        background: `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)`,
        backgroundSize: 'cover',
    })

    // Дебаунсинг функции поиска
    const debouncedFetchUsers = useCallback(
        debounce((page: number, perPage: number, sorting: any, search: string) => {
            setLoading(true)
            apolloClient
                .query({
                    query: GetAllUsersQuery,
                    variables: {
                        perPage,
                        page,
                        sorting,
                        search,
                    },
                })
                .then((result) => {
                    if (result.data) {
                        const data = result.data.getUsersWithPagination
                        setLoading(false)
                        setUsers(data.users)
                        setMaxPages(data.totalPages)
                    }
                })
                .catch((e) => {
                    console.error(e)
                    toast.error('Произошла ошибка!')
                    setLoading(false)
                })
        }, 300), // Задержка 300 мс
        [],
    )

    useEffect(() => {
        debouncedFetchUsers(page, 50, sorting, search)
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
                return [
                    {
                        id: field,
                        desc: !prevSorting[0].desc,
                    },
                ]
            } else {
                return [
                    {
                        id: field,
                        desc: true,
                    },
                ]
            }
        })
    }

    const getSortIcon = (field: string) => {
        if (sorting.length === 0 || sorting[0].id !== field) {
            return null
        }
        return sorting[0].desc ? (
            <FaSortDown className={styles.sortIcon} />
        ) : (
            <FaSortUp className={styles.sortIcon} />
        )
    }

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

    const isFieldSorted = (field: string) => {
        return sorting.length > 0 && sorting[0].id === field
    }

    useEffect(() => {
        const usersWithBanner = users.filter((user) => user.banner)

        const checkBannerAvailability = (userList: string | any[], index = 0) => {
            if (index >= userList.length) {
                setBackgroundStyle({
                    background: `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)`,
                    backgroundSize: 'cover',
                })
                return
            }

            const user = userList[index]
            const img = new Image()
            img.src = user.banner

            img.onload = () => {
                setBackgroundStyle({
                    background: `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%), url(${user.banner}) no-repeat center center`,
                    backgroundSize: 'cover',
                })
            }

            img.onerror = () => {
                checkBannerAvailability(userList, index + 1)
            }
        }

        if (usersWithBanner.length > 0) {
            checkBannerAvailability(usersWithBanner)
        } else {
            setBackgroundStyle({
                background: `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)`,
                backgroundSize: 'cover',
            })
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
                                            setPage(1) // Сбрасываем на первую страницу при новом поиске
                                        }}
                                    />
                                </div>
                                <div className={styles.userNav}>
                                    <div className={styles.userNavContainer}>
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
                                    {users.length > 0 ? (
                                        <>{renderPagination()}</>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <div className={globalStyles.container30x15}>
                            {loading ? (
                                <div>Загрузка...</div>
                            ) : (
                                <div className={styles.userPage}>
                                    {users.length > 0 ? (
                                        <table className={styles.usersTable}>
                                            <tbody>
                                                {users.map((user) => (
                                                    <tr
                                                        key={user.id}
                                                        style={{
                                                            background: user.banner
                                                                ? `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%), url(${user.banner}) no-repeat center center`
                                                                : `linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)`,
                                                        }}
                                                        className={styles.userRow}
                                                    >
                                                        <td
                                                            className={
                                                                styles.userName
                                                            }
                                                        >
                                                            <img
                                                                className={
                                                                    styles.userAvatar
                                                                }
                                                                src={user.avatar}
                                                                alt={user.username}
                                                                onError={(e) => {
                                                                    ;(
                                                                        e.currentTarget as HTMLImageElement
                                                                    ).src =
                                                                        './static/assets/images/undef.png'
                                                                }}
                                                            />
                                                            {user.username}
                                                        </td>
                                                        <td
                                                            className={
                                                                styles.userDate
                                                            }
                                                        >
                                                            {new Date(
                                                                user.createdAt,
                                                            ).toLocaleDateString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
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
