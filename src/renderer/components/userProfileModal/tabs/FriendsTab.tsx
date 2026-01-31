import React from 'react'
import { useTranslation } from 'react-i18next'
import * as styles from '../../userProfileModal/userProfileModal.module.scss'
import { ExtendedUser } from '../../../api/interfaces/extendUser.interface'

interface FriendsTabProps {
    userProfile: ExtendedUser
    loading: boolean
    error: any
}

const FriendsTab: React.FC<FriendsTabProps> = ({ userProfile, loading, error }) => {
    const { t } = useTranslation()

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.loader}>
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                </div>
                <div>{t('common.loading')}</div>
            </div>
        )
    }

    if (error) {
        return <div>{t('profile.errors.withMessage', { message: String(error) })}</div>
    }

    if (!userProfile || !userProfile.id || userProfile.id === '-1') {
        return <div>{t('profile.errors.userNotFound')}</div>
    }

    return (
        <div className={styles.friendsContainer}>
            <h2>{t('profile.tabs.friends')}</h2>
            <div className={styles.friendsList}>{t('profile.friends.placeholder')}</div>
        </div>
    )
}

export default FriendsTab
