import React from 'react'
import * as styles from '../../userProfileModal/userProfileModal.module.scss'
import { ExtendedUser } from '../../../api/interfaces/extendUser.interface'

interface FriendsTabProps {
    userProfile: ExtendedUser
    loading: boolean
    error: any
}

const FriendsTab: React.FC<FriendsTabProps> = ({ userProfile, loading, error }) => {
    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.loader}>
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                </div>
                <div>Загрузка...</div>
            </div>
        )
    }

    if (error) {
        return <div>Ошибка: {String(error)}</div>
    }

    if (!userProfile || !userProfile.id || userProfile.id === '-1') {
        return <div>Пользователь не найден</div>
    }

    return (
        <div className={styles.friendsContainer}>
            <h2>Друзья</h2>
            <div className={styles.friendsList}>hi</div>
        </div>
    )
}

export default FriendsTab
