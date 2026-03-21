import React from 'react'
import { useTranslation } from 'react-i18next'
import * as styles from '@widgets/userProfileModal/userProfileModal.module.scss'
import { ExtendedUser } from '@entities/user/model/extendUser.interface'
import Loader from '@shared/ui/PSUI/Loader'

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
                <Loader variant="panel" />
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
