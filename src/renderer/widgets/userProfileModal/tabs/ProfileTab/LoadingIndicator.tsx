import React from 'react'
import Loader from '@shared/ui/PSUI/Loader'
import * as styles from '@widgets/userProfileModal/userProfileModal.module.scss'

const LoadingIndicator: React.FC = () => {
    return (
        <div className={styles.profileLoadingContainer}>
            <Loader variant="profile" />
        </div>
    )
}

export default LoadingIndicator
