import React, { useEffect, useState } from 'react'
import apolloClient from '../../api/apolloClient'
import getUserProfileQuery from '../../api/queries/user/getUserProfile.query'
import userInitials from '../../api/initials/user.initials'
import UserInterface from '../../api/interfaces/user.interface'

import ProfileTab from './tabs/ProfileTab'
import FriendsTab from './tabs/FriendsTab'
import SettingsTab from './tabs/SettingsTab'
import * as styles from './userProfileModal.module.scss'

import { MdPersonOutline, MdPeopleOutline, MdSettings, MdClose } from 'react-icons/md'

export interface ExtendedUser extends UserInterface {
    allAchievements?: any[]
}

interface UserProfileModalProps {
    isOpen: boolean
    onClose: () => void
    username: string
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({ isOpen, onClose, username }) => {
    const [userProfile, setUserProfile] = useState<ExtendedUser>(userInitials)
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<any>(null)

    const [shouldRender, setShouldRender] = useState(isOpen)
    const [animationClass, setAnimationClass] = useState(styles.closed)

    const [activeTab, setActiveTab] = useState<'profile' | 'friends' | 'settings'>('profile')

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true)
        } else {
            const timer = setTimeout(() => setShouldRender(false), 300)
            return () => clearTimeout(timer)
        }
    }, [isOpen])

    useEffect(() => {
        if (isOpen) {
            setAnimationClass(styles.closed)
            requestAnimationFrame(() => {
                setAnimationClass(styles.open)
            })
        } else {
            setAnimationClass(styles.closed)
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen || !username) return

        setUserProfile(userInitials)
        setLoading(true)
        setError(null)

        apolloClient
            .query({
                query: getUserProfileQuery,
                variables: {
                    name: username,
                    page: 1,
                    pageSize: 50,
                    search: '',
                    sortOptions: [],
                },
                fetchPolicy: 'no-cache',
            })
            .then(res => {
                if (!res.data.findUserByName) {
                    setError('Пользователь не найден')
                } else {
                    setUserProfile({
                        ...res.data.findUserByName,
                        allAchievements: res.data.getAchievements?.achievements || [],
                    })
                }
            })
            .catch(err => setError(err))
            .finally(() => {
                setLoading(false)
            })
    }, [isOpen, username])

    if (!shouldRender) return null

    const handleTabChange = (tab: 'profile' | 'friends' | 'settings') => {
        setActiveTab(tab)
    }

    const renderTabTitle = () => {
        if (activeTab === 'profile') {
            return (
                <>
                    <MdPersonOutline size={34} />
                    <span>Профиль {username}</span>
                </>
            )
        }
        if (activeTab === 'friends') {
            return (
                <>
                    <MdPeopleOutline size={34} />
                    <span>Друзья {username}</span>
                </>
            )
        }
        if (activeTab === 'settings') {
            return (
                <>
                    <MdSettings size={34} />
                    <span>Настройки профиля</span>
                </>
            )
        }
        return null
    }

    return (
        <div className={`${styles.overlay} ${animationClass}`}>
            <div className={`${styles.modalContainer} ${animationClass}`} onClick={e => e.stopPropagation()}>
                <div className={styles.currentTabLabel}>
                    {renderTabTitle()}
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
                        <MdClose size={22} />
                    </button>
                </div>

                {/* <div className={styles.tabsHeader}>
                    <button
                        onClick={() => handleTabChange('profile')}
                        className={activeTab === 'profile' ? styles.activeTab : ''}
                    >
                        Профиль
                    </button>
                    <button
                        onClick={() => handleTabChange('friends')}
                        className={activeTab === 'friends' ? styles.activeTab : ''}
                    >
                        Друзья
                    </button>
                    <button
                        onClick={() => handleTabChange('settings')}
                        className={activeTab === 'settings' ? styles.activeTab : ''}
                    >
                        Настройки
                    </button>
                </div> */}

                <div className={styles.modalContent}>
                    {activeTab === 'profile' && <ProfileTab userProfile={userProfile} loading={loading} error={error} username={username} />}

                    {activeTab === 'friends' && <FriendsTab userProfile={userProfile} loading={loading} error={error} />}

                    {activeTab === 'settings' && <SettingsTab userProfile={userProfile} loading={loading} error={error} />}
                </div>
            </div>
        </div>
    )
}

export default UserProfileModal
