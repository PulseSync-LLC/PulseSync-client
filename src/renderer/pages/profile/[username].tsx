import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client/react'

import getUserProfileQuery from '../../api/queries/user/getUserProfile.query'
import getMeProfileQuery from '../../api/queries/user/getMeProfile.query'
import userInitials from '../../api/initials/user.initials'
import UserInterface from '../../api/interfaces/user.interface'

import PageLayout from '../PageLayout'
import Scrollbar from '../../components/PSUI/Scrollbar'

import ProfileTab from '../../components/userProfileModal/tabs/ProfileTab'
import FriendsTab from '../../components/userProfileModal/tabs/FriendsTab'
import SettingsTab from '../../components/userProfileModal/tabs/SettingsTab'

import * as styles from './profilePage.module.scss'
import { MdPeopleOutline, MdPersonOutline, MdSettings } from 'react-icons/md'
import { ExtendedUser } from '../../api/interfaces/extendUser.interface'
import userContext from '../../api/context/user.context'

const USER_NOT_FOUND_MSG = 'Пользователь не найден'

const ProfilePage: React.FC = () => {
    const { username: raw } = useParams()
    const navigate = useNavigate()
    const username = decodeURIComponent(raw || '')
    const { user } = useContext(userContext)

    const [activeTab, setActiveTab] = useState<'profile' | 'friends' | 'settings'>('profile')

    const isSelf = useMemo(() => {
        if (!username) return false
        const u = user?.username || ''
        return u.toLowerCase() === username.toLowerCase()
    }, [user?.username, username])

    const queryDoc = useMemo(() => (isSelf ? getMeProfileQuery : getUserProfileQuery), [isSelf])

    const variables = useMemo(
        () =>
            isSelf
                ? { page: 1, pageSize: 50 }
                : {
                      name: username,
                      page: 1,
                      pageSize: 50,
                      search: '',
                      sortOptions: [] as Array<unknown>,
                  },
        [isSelf, username],
    )

    const { data, loading, error } = useQuery<any>(queryDoc, {
        variables,
        fetchPolicy: 'no-cache',
        skip: !username,
    })

    const payload: ExtendedUser | null = useMemo(() => {
        if (!data) return null
        return (isSelf ? data.getMeProfile : data.findUserByName) || null
    }, [data, isSelf])

    const userProfile: ExtendedUser = useMemo<ExtendedUser>(() => {
        if (!payload) return userInitials
        return {
            ...payload,
            allAchievements: data?.getAchievements?.achievements || [],
        }
    }, [payload, data])

    const normalizedError: string | null = useMemo(() => {
        if (error) return error.message || 'Ошибка загрузки'
        if (!loading && username && !payload) return USER_NOT_FOUND_MSG
        return null
    }, [error, loading, username, payload])

    const onEscPress = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') navigate(-1)
        },
        [navigate],
    )

    useEffect(() => {
        document.addEventListener('keydown', onEscPress, true)
        return () => document.removeEventListener('keydown', onEscPress, true)
    }, [onEscPress])

    const renderTabTitle = useCallback(() => {
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
    }, [activeTab, username])

    return (
        <PageLayout title="Профиль">
            <Scrollbar className={styles.scrollArea} classNameInner={styles.scrollAreaInner}>
                {/*<div className={styles.tabs}>{renderTabTitle()}</div>*/}
                {/* <div className={styles.tabs}>
                <button onClick={() => setActiveTab('profile')}  className={activeTab === 'profile'  ? styles.activeTab : ''}>Профиль</button>
                <button onClick={() => setActiveTab('friends')}  className={activeTab === 'friends'  ? styles.activeTab : ''}>Друзья</button>
                <button onClick={() => setActiveTab('settings')} className={activeTab === 'settings' ? styles.activeTab : ''}>Настройки</button>
              </div> */}

                <div className={styles.content}>
                    {activeTab === 'profile' && (
                        <ProfileTab userProfile={userProfile} loading={loading} error={normalizedError} username={username} />
                    )}
                    {activeTab === 'friends' && <FriendsTab userProfile={userProfile} loading={loading} error={normalizedError} />}
                    {activeTab === 'settings' && <SettingsTab userProfile={userProfile} loading={loading} error={normalizedError} />}
                </div>
            </Scrollbar>
        </PageLayout>
    )
}

export default ProfilePage
