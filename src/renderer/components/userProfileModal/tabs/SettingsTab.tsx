import React from 'react'
import { ExtendedUser } from '../index'
import * as styles from '../../userProfileModal/userProfileModal.module.scss'

interface SettingsTabProps {
    userProfile: ExtendedUser
    loading: boolean
    error: any
}

const SettingsTab: React.FC<SettingsTabProps> = ({ userProfile, loading, error }) => {
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

    return (
        <div className={styles.settingsContainer}>
            <h2>Настройки профиля</h2>
            <p>Тут вы можете добавить форму редактирования и т.п.</p>
        </div>
    )
}

export default SettingsTab
