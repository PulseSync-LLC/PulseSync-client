import React, { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import config from '../../api/config'
import Button from '../../components/button'

import Layout from '../../components/layout'

import * as globalStyles from '../../../../static/styles/page/index.module.scss'
import * as styles from './userProfile.module.scss'
import apolloClient from '../../api/apolloClient'
import findUserByName from '../../api/queries/user/findUserByName.query'
import UserInterface from '../../api/interfaces/user.interface'
import userInitials from '../../api/initials/user.initials'
import { MdKeyboardArrowDown, MdMoreHoriz } from 'react-icons/md'

function UserProfilePage() {
    const { param } = useParams()
    const [user, setUser] = useState<UserInterface>(userInitials)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [bannerHeight, setBannerHeight] = useState(184)
    const [backgroundStyle, setBackgroundStyle] = useState<React.CSSProperties>({})
    const [bannerExpanded, setBannerExpanded] = useState(false)

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null
        const targetHeight = bannerExpanded ? 477 : 184
        const step = bannerExpanded ? -1 : 1

        const animateBannerHeight = () => {
            setBannerHeight((prev) => {
                if (
                    (step < 0 && prev <= targetHeight) ||
                    (step > 0 && prev >= targetHeight)
                ) {
                    if (interval) clearInterval(interval)
                    return targetHeight
                }
                return prev + step
            })
        }

        interval = setInterval(animateBannerHeight, 5)
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [bannerExpanded])

    const toggleBanner = () => {
        const newState = !bannerExpanded
        setBannerExpanded(newState)
    }

    useEffect(() => {
        if (!param) return

        const fetchData = async () => {
            setLoading(true)
            setError(null)
            try {
                const res = await apolloClient.query({
                    query: findUserByName,
                    variables: { name: param },
                    fetchPolicy: 'no-cache',
                })
                if (res.data.findUserByName === null) {
                    setError('User not found')
                } else {
                    setUser(res.data.findUserByName)
                }
            } catch (err) {
                setError(err)
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [param])

    useEffect(() => {
        if (!user) return

        if (user.bannerHash && user.bannerHash !== 'default_banner') {
            const bannerUrl = `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
            const bannerImg = new Image()
            bannerImg.src = bannerUrl

            bannerImg.onload = () => {
                setBackgroundStyle({
                    background: `
            linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%),
            url(${bannerUrl}) no-repeat center center
          `,
                    backgroundSize: 'cover',
                })
            }
            bannerImg.onerror = () => {
                setBackgroundStyle({
                    background:
                        'linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)',
                })
            }
        } else {
            setBackgroundStyle({
                background:
                    'linear-gradient(90deg, #292C36 0%, rgba(41, 44, 54, 0.82) 100%)',
            })
        }
    }, [user])

    if (!param) {
        return (
            <Layout title="Профиль пользователя">
                <p>Не задан параметр (id или username).</p>
            </Layout>
        )
    }

    if (loading) {
        return (
            <Layout title="Загрузка...">
                <div className={styles.loading}>Загрузка профиля...</div>
            </Layout>
        )
    }

    if (error) {
        return (
            <Layout title="Ошибка">
                <p>Ошибка: {error.message}</p>
            </Layout>
        )
    }

    if (!user) {
        return (
            <Layout title="Профиль пользователя">
                <p>Пользователь не найден</p>
            </Layout>
        )
    }

    const bannerUrl = `${config.S3_URL}/banners/${user.bannerHash}.${user.bannerType}`
    const avatarUrl = `${config.S3_URL}/avatars/${user.avatarHash}.${user.avatarType}`

    const badges = Array.isArray(user.badges) ? user.badges : []

    return (
        // <Layout title={`Профиль ${user.username}`}>
        //     <div className={globalStyles.page}>
        //         <div className={globalStyles.container}>
        //             <div className={globalStyles.main_container}>
        //                 <div
        //                     className={styles.bannerContainer}
        //                     style={backgroundStyle}
        //                 >
        //                     <div className={styles.overlay}>
        //                         <div className={styles.profileInfo}>
        //                             <img
        //                                 className={styles.avatar}
        //                                 src={bannerUrl}
        //                                 alt="Banner"
        //                                 onError={(e) => {
        //                                     ;(
        //                                         e.currentTarget as HTMLImageElement
        //                                     ).src =
        //                                         './static/assets/images/undef.png'
        //                                 }}
        //                             />
        //                             <img
        //                                 className={styles.avatar}
        //                                 src={avatarUrl}
        //                                 alt="Avatar"
        //                                 onError={(e) => {
        //                                     ;(
        //                                         e.currentTarget as HTMLImageElement
        //                                     ).src =
        //                                         './static/assets/images/undef.png'
        //                                 }}
        //                             />

        //                             <div className={styles.nameBlock}>
        //                                 <h2 className={styles.username}>
        //                                     {user.username}
        //                                 </h2>
        //                                 {user.nickname && (
        //                                     <p className={styles.nickname}>
        //                                         Nickname: {user.nickname}
        //                                     </p>
        //                                 )}
        //                                 {user.status && (
        //                                     <p className={styles.status}>
        //                                         Status: {user.status}
        //                                     </p>
        //                                 )}
        //                             </div>
        //                         </div>
        //                     </div>
        //                 </div>
        //                 <div className={globalStyles.container30x15}>
        //                     <div className={styles.badgesContainer}>
        //                         <h3>Значки</h3>
        //                         {badges.length > 0 ? (
        //                             <div className={styles.badgesGrid}>
        //                                 {badges.map((badge: any) => (
        //                                     <div
        //                                         className={styles.badgeCard}
        //                                         key={badge.uuid}
        //                                     >
        //                                         <p className={styles.badgeName}>
        //                                             {badge.name}
        //                                         </p>
        //                                         <p className={styles.badgeType}>
        //                                             Type: {badge.type}
        //                                         </p>
        //                                         <p className={styles.badgeLevel}>
        //                                             Level: {badge.level}
        //                                         </p>
        //                                     </div>
        //                                 ))}
        //                             </div>
        //                         ) : (
        //                             <p>Нет значков</p>
        //                         )}
        //                     </div>
        //                     <div style={{ marginTop: 20 }}>
        //                         <Link to="/users" className={styles.backLink}>
        //                             ← Вернуться к списку пользователей
        //                         </Link>
        //                     </div>
        //                 </div>
        //             </div>
        //         </div>
        //     </div>
        // </Layout>

        <Layout title={`Профиль ${user.username}`}>
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div className={globalStyles.container0x0}>
                            <div className={styles.containerFix}>
                                <div
                                    className={styles.bannerBackground}
                                    style={{
                                        transition: true
                                            ? 'opacity 0.5s ease, height 0.5s ease, gap 0.5s ease'
                                            : 'none',
                                        opacity: '1',
                                        backgroundImage: `url(${bannerUrl})`,
                                        backgroundSize: 'cover',
                                        height: `${bannerHeight}px`,
                                    }}
                                >
                                    <Button
                                        className={styles.hideButton}
                                        onClick={() => {
                                            setBannerExpanded((prev) => !prev)
                                            toggleBanner()
                                        }}
                                        title={
                                            bannerExpanded
                                                ? 'Свернуть баннер'
                                                : 'Развернуть баннер'
                                        }
                                    >
                                        <MdKeyboardArrowDown
                                            size={20}
                                            style={
                                                bannerExpanded
                                                    ? {
                                                          transition:
                                                              'transform 0.3s ease',
                                                          transform:
                                                              'rotate(180deg)',
                                                      }
                                                    : {
                                                          transition:
                                                              'transform 0.3s ease',
                                                          transform: 'rotate(0deg)',
                                                      }
                                            }
                                        />
                                    </Button>
                                </div>
                                <div className={styles.themeInfo}>
                                    <div className={styles.themeHeader}>
                                        <div className={styles.containerLeft}>
                                            <img
                                                className={styles.themeImage}
                                                src={avatarUrl}
                                                alt="Avatar"
                                                onError={(e) => {
                                                    ;(
                                                        e.currentTarget as HTMLImageElement
                                                    ).src =
                                                        './static/assets/images/undef.png'
                                                }}
                                                width="100"
                                                height="100"
                                            />
                                        </div>
                                    </div>

                                    <div className={styles.rightContainer}>
                                        <div>
                                            <div
                                                className={
                                                    styles.miniButtonsContainer
                                                }
                                            >
                                                <Button
                                                    className={`${styles.defaultButton}`}
                                                    title={'{ Add friend }'}
                                                >
                                                    {'{ Add friend }'}
                                                </Button>
                                                <Button
                                                    className={styles.miniButton}
                                                    title="More"
                                                >
                                                    <MdMoreHoriz size={20} />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default UserProfilePage
