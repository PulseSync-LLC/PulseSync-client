import React from 'react'
import * as styles from '../../userProfileModal.module.scss'

const LoadingIndicator: React.FC = () => (
    <div className={styles.loadingContainer}>
        <div className={styles.loader}>
            <div className={styles.dot} />
            <div className={styles.dot} />
            <div className={styles.dot} />
        </div>
        <div>Загрузка...</div>
    </div>
)

export default LoadingIndicator
