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
import TooltipButton from '../../components/tooltip_button'

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
        <Layout title={`Профиль ${user.username}`}>
            <div className={globalStyles.page}>
                <div className={globalStyles.container}>
                    <div className={globalStyles.main_container}>
                        <div className={globalStyles.container0x0}>
                            <div className={styles.containerFix}>
                                <div
                                    className={styles.bannerBackground}
                                    style={{
                                        transition:
                                            'opacity 0.5s ease, height 0.5s ease, gap 0.5s ease',
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
                                <div className={styles.userInfo}>
                                    <div className={styles.userHeader}>
                                        <div className={styles.userContainerLeft}>
                                            <img
                                                className={styles.userImage}
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

                                            <div className={styles.userInfoText}>
                                                <div className={styles.userName}>
                                                    {user.nickname || 'Без никнейма'}{' '}
                                                    <div
                                                        className={styles.userBadges}
                                                    >
                                                        {user.badges.length > 0 &&
                                                            user.badges
                                                                .sort(
                                                                    (a, b) =>
                                                                        b.level -
                                                                        a.level,
                                                                )
                                                                .map((_badge) => (
                                                                    <TooltipButton
                                                                        tooltipText={
                                                                            _badge.name
                                                                        }
                                                                        side="top"
                                                                        className={
                                                                            styles.badge
                                                                        }
                                                                        key={
                                                                            _badge.type
                                                                        }
                                                                    >
                                                                        <img
                                                                            src={`static/assets/badges/${_badge.type}.svg`}
                                                                            alt={
                                                                                _badge.type
                                                                            }
                                                                        />
                                                                    </TooltipButton>
                                                                ))}
                                                    </div>
                                                </div>
                                                <div className={styles.userUsername}>
                                                    @{user.username}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={styles.rightContainer}>
                                        <TooltipButton
                                            tooltipText={'Скоро'}
                                            side="top"
                                            className={styles.miniButtonsContainer}
                                        >
                                            <Button
                                                disabled
                                                className={`${styles.defaultButton}`}
                                            >
                                                {'Добавить в друзья'}
                                            </Button>
                                            <Button
                                                disabled
                                                className={styles.miniButton}
                                            >
                                                <MdMoreHoriz size={20} />
                                            </Button>
                                        </TooltipButton>
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
