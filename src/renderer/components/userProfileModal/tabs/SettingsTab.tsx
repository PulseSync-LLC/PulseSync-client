import React from 'react'
import { useTranslation } from 'react-i18next'
import * as styles from '../../userProfileModal/userProfileModal.module.scss'
import { ExtendedUser } from '../../../api/interfaces/extendUser.interface'

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

    return (
        <div className={styles.settingsContainer}>
            <h2>{t('profile.tabs.settings')}</h2>
            <p>{t('profile.settings.placeholder')}</p>
        </div>
    )
}

export default SettingsTab
