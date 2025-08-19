import React, { useContext, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import apolloClient from '../../api/apolloClient'
import getUserProfileQuery from '../../api/queries/user/getUserProfile.query'
import getMeProfileQuery from '../../api/queries/user/getMeProfile.query'
import userInitials from '../../api/initials/user.initials'
import UserInterface from '../../api/interfaces/user.interface'

import Layout from '../../components/layout'
import Scrollbar from '../../components/PSUI/Scrollbar'

import ProfileTab from '../../components/userProfileModal/tabs/ProfileTab'
import FriendsTab from '../../components/userProfileModal/tabs/FriendsTab'
import SettingsTab from '../../components/userProfileModal/tabs/SettingsTab'

import * as pageStyles from '../../../../static/styles/page/index.module.scss'
import * as styles from './profilePage.module.scss'
import { MdPersonOutline, MdPeopleOutline, MdSettings, MdClose } from 'react-icons/md'
import { ExtendedUser } from '../../api/interfaces/extendUser.interface'
import userContext from '../../api/context/user.context'

const USER_NOT_FOUND_MSG = 'Пользователь не найден'

const ProfilePage: React.FC = () => {
    const { username: raw } = useParams()
    const navigate = useNavigate()
    const username = decodeURIComponent(raw || '')
    const { user } = useContext(userContext)
    const [userProfile, setUserProfile] = useState<ExtendedUser>(userInitials)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'profile' | 'friends' | 'settings'>('profile')

    useEffect(() => {
        if (!username) return
        setUserProfile(userInitials)
        setLoading(true)
        setError(null)

        const isSelf = Boolean(user?.username) && user!.username!.toLowerCase() === username.toLowerCase()

        const query = isSelf ? getMeProfileQuery : getUserProfileQuery

        const baseOptions: any = {
            query,
            fetchPolicy: 'no-cache',
        }

        if (isSelf) {
            baseOptions.variables = {
                page: 1,
                pageSize: 50,
            }
        } else {
            baseOptions.variables = {
                name: username,
                page: 1,
                pageSize: 50,
                search: '',
                sortOptions: [],
            }
        }

        apolloClient
            .query(baseOptions)
            .then(res => {
                const payload = isSelf ? res.data.getMeProfile : res.data.findUserByName
                if (!payload) {
                    setError(USER_NOT_FOUND_MSG)
                } else {
                    setUserProfile({
                        ...payload,
                        allAchievements: res.data.getAchievements?.achievements || [],
                    })
                }
            })
            .catch(err => setError((err && (err.message || String(err))) || 'Ошибка загрузки'))
            .finally(() => setLoading(false))
    }, [username, user?.username])

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') navigate(-1)
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
    }, [navigate])

    const renderTabTitle = () => {
        if (activeTab === 'profile')
            return (
                <>
                    <MdPersonOutline size={34} />
                    <span>Профиль {username}</span>
                </>
            )
        if (activeTab === 'friends')
            return (
                <>
                    <MdPeopleOutline size={34} />
                    <span>Друзья {username}</span>
                </>
            )
        if (activeTab === 'settings')
            return (
                <>
                    <MdSettings size={34} />
                    <span>Настройки профиля</span>
                </>
            )
        return null
    }

    return (
        <Layout title={`Профиль`}>
            <div className={pageStyles.page}>
                <div className={pageStyles.container}>
                    <div className={pageStyles.main_container}>
                        <Scrollbar className={styles.scrollArea} classNameInner={styles.scrollAreaInner}>
                            {/* <div className={styles.tabs}>
                <button onClick={() => setActiveTab('profile')}  className={activeTab === 'profile'  ? styles.activeTab : ''}>Профиль</button>
                <button onClick={() => setActiveTab('friends')}  className={activeTab === 'friends'  ? styles.activeTab : ''}>Друзья</button>
                <button onClick={() => setActiveTab('settings')} className={activeTab === 'settings' ? styles.activeTab : ''}>Настройки</button>
              </div> */}

                            <div className={styles.content}>
                                {activeTab === 'profile' && (
                                    <ProfileTab userProfile={userProfile} loading={loading} error={error} username={username} />
                                )}
                                {activeTab === 'friends' && <FriendsTab userProfile={userProfile} loading={loading} error={error} />}
                                {activeTab === 'settings' && <SettingsTab userProfile={userProfile} loading={loading} error={error} />}
                            </div>
                        </Scrollbar>
                    </div>
                </div>
            </div>
        </Layout>
    )
}

export default ProfilePage
