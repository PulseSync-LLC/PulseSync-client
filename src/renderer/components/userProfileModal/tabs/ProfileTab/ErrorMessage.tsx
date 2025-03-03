import React from 'react'
import * as styles from '../../userProfileModal.module.scss'

interface ErrorMessageProps {
    message: string
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message }) => (
    <div className={styles.loadingContainer}>{message}</div>
)

export default ErrorMessage
