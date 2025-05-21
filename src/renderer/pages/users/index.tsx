
import Layout from '../../components/layout'
import * as s from './users.module.scss'
import * as styles from '../../../../static/styles/page/index.module.scss'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useSubscription } from '@apollo/client'
import UserInterface from '../../api/interfaces/user.interface'
import GetAllUsersQuery from '../../api/queries/user/getAllUsers.query'
import GetAllUsersSubscription from '../../api/queries/user/getAllUsers.subscription'
import apolloClient from '../../api/apolloClient'
import debounce from 'lodash.debounce'
import { MdAllOut, MdHourglassEmpty, MdAccessTime, MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md'
import { motion } from 'framer-motion'
import config from '../../api/config'
import toast from '../../components/toast'
import { useUserProfileModal } from '../../context/UserProfileModalContext'
import UserCard from '../../components/userCard'
import ContainerV2 from '../../components/containerV2'
import Tabs from '../../components/PSUI/Tabs'
import Scrollbar from '../../components/PSUI/Scrollbar'

const PER_PAGE = 100
const PLACEHOLDER_COUNT = PER_PAGE

interface PlaceholderUser {
  id: string
  placeholder: true
}

type DisplayUser = UserInterface | PlaceholderUser

export default function UsersPage() {
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<DisplayUser[]>(() =>
    Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => ({ id: `placeholder-${i}`, placeholder: true }))
  )
  const [page, setPage] = useState(1)
  const [maxPages, setMaxPages] = useState(1)
  const [sorting, setSorting] = useState([{ id: 'lastOnline', desc: true }])
  const [search, setSearch] = useState('')
  const { openUserProfile } = useUserProfileModal()

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

  const { data: subData } = useSubscription(GetAllUsersSubscription, {
    variables: { page, perPage: PER_PAGE, sorting, search },
  })

  useEffect(() => {
    if (subData?.subscribeUsersWithPagination) {
      const { users: raw, totalPages } = subData.subscribeUsersWithPagination
      setUsers(processUsers(raw))
      setMaxPages(totalPages)
      setLoading(false)
    }
  }, [subData, sorting])

  const debouncedFetchUsers = useCallback(
    debounce((page: number, perPage: number, sorting: any, search: string) => {
      if (page > 1) {
        setUsers(prev => [
          ...prev,
          ...Array.from({ length: perPage }, (_, i) => ({ id: `placeholder-${page}-${i}`, placeholder: true })) as DisplayUser[],
        ])
      }

      apolloClient
        .query({
          query: GetAllUsersQuery,
          variables: { perPage, page, sorting, search },
          fetchPolicy: 'no-cache',
        })
        .then(result => {
          if (result.data) {
            const { users: raw, totalPages } = result.data.getUsersWithPagination
            setUsers(prev => {
              const withoutPlaceholders = prev.filter(u => !(typeof u === 'object' && 'placeholder' in u))
              return page === 1 ? processUsers(raw) : [...withoutPlaceholders, ...processUsers(raw)]
            })
            setMaxPages(totalPages)
          }
          setLoading(false)
        })
        .catch(e => {
          console.error(e)
          toast.custom('error', 'Ошибка', 'Произошла ошибка при получении пользователей!')
          setLoading(false)
        })
    }, 300),
    [sorting]
  )

  useEffect(() => {
    debouncedFetchUsers(page, PER_PAGE, sorting, search)
  }, [sorting, page, search, debouncedFetchUsers])

  const scrollbarRef = useRef<HTMLDivElement>(null)

  const tryAutoLoad = useCallback(() => {
    const el = scrollbarRef.current
    if (!el || loading) return
    if (el.scrollHeight <= el.clientHeight + 20 && page < maxPages) {
      setPage(p => p + 1)
    }
  }, [loading, page, maxPages])

  useEffect(() => {
    tryAutoLoad()
  }, [users, tryAutoLoad])

  const onScroll = useCallback(
    debounce(() => {
      const el = scrollbarRef.current
      if (!el || loading || page >= maxPages) return
      const { scrollTop, clientHeight, scrollHeight } = el
      if (scrollTop + clientHeight >= scrollHeight - 20) {
        setPage(p => p + 1)
      }
    }, 200),
    [loading, page, maxPages]
  )

  const handleSort = (field: string) => {
    setPage(1)
    setSorting(prev => (prev[0].id === field ? [{ id: field, desc: !prev[0].desc }] : [{ id: field, desc: true }]))
  }

  const tabConfigs = [
    { title: 'Последняя активность', icon: <MdAccessTime />, field: 'lastOnline' },
    { title: 'Дата регистрации', icon: <MdHourglassEmpty />, field: 'createdAt' },
    { title: 'Имя пользователя', icon: <MdAllOut />, field: 'username' },
    { title: 'Уровень', icon: <MdAllOut />, field: 'level' },
  ]

  const activeTab = tabConfigs.find(c => sorting[0].id === c.field)?.title ?? tabConfigs[0].title

  const onTabChange = (title: string) => {
    const cfg = tabConfigs.find(c => c.title === title)
    if (cfg) handleSort(cfg.field)
  }

  const defaultBackground = useMemo(
    () => ({
      minHeight: '75px',
      alignItems: 'flex-end',
      display: 'flex',
      padding: '12px 40px',
      backgroundImage: 'linear-gradient(180deg, rgba(35, 39, 55, 0.8) 0%, #232737 100%)',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center center',
      backgroundSize: 'cover',
    }),
    []
  )
  const [backgroundStyle, setBackgroundStyle] = useState(defaultBackground)

  useEffect(() => {
    const realUsers = users.filter((u): u is UserInterface => !(typeof u === 'object' && 'placeholder' in u))
    const usersWithBanner = realUsers.filter(u => u.bannerHash)
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
          backgroundImage: `linear-gradient(180deg, rgba(35, 39, 55, 0.8) 0%, #232737 100%), url(${url})`,
        })
      img.onerror = () => checkBanner(list, idx + 1)
    }
    usersWithBanner.length ? checkBanner(usersWithBanner) : setBackgroundStyle(defaultBackground)
  }, [users, defaultBackground])

  return (
    <Layout title="Пользователи">
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.main_container}>
            <Scrollbar
              ref={scrollbarRef}
              onScroll={onScroll}
              className={s.containerFix}
              classNameInner={s.containerFixInner}
            >
              <ContainerV2 titleName="Пользователи" imageName="users" style={backgroundStyle} />
              <Tabs
                active={activeTab}
                onChange={onTabChange}
                tabs={tabConfigs.map(({ title, icon }) => ({ title, icon }))}
                sortDirection={sorting[0].desc ? 'desc' : 'asc'}
                stickyPos={{ top: '0px' }}
              />

              <div className={s.userPage}>
                {users.length > 0 ? (
                  <div className={s.userGrid}>
                    {users.map(user => (
                      <UserCard
                        key={user.id}
                        user={user as UserInterface}
                        placeholder={(user as PlaceholderUser).placeholder === true}
                        onClick={openUserProfile}
                      />
                    ))}
                  </div>
                ) : (
                  !loading && <div className={s.noResults}>Нет результатов</div>
                )}
              </div>
            </Scrollbar>
          </div>
        </div>
      </div>
    </Layout>
  )
}

