import React from 'react'
import { useTranslation } from 'react-i18next'
import * as styles from '../../userProfileModal.module.scss'

const LoadingIndicator: React.FC = () => {
    const { t } = useTranslation()

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

export default LoadingIndicator
