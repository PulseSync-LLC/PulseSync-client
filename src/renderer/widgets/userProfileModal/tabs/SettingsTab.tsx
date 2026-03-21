import React from 'react'
import { useTranslation } from 'react-i18next'
import * as styles from '@widgets/userProfileModal/userProfileModal.module.scss'
import { ExtendedUser } from '@entities/user/model/extendUser.interface'
import Loader from '@shared/ui/PSUI/Loader'

interface SettingsTabProps {
    userProfile: ExtendedUser
    loading: boolean
    error: any
}

const SettingsTab: React.FC<SettingsTabProps> = ({ userProfile, loading, error }) => {
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

    return (
        <div className={styles.settingsContainer}>
            <h2>{t('profile.tabs.settings')}</h2>
            <p>{t('profile.settings.placeholder')}</p>
        </div>
    )
}

export default SettingsTab
