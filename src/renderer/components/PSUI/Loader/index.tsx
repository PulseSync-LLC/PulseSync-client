import React from 'react'
import * as styles from './Loader.module.scss'
import { useTranslation } from 'react-i18next'

export default function Loader({ text }: { text?: string }) {
    const { t } = useTranslation()
    const displayText = text ?? t('common.loadingThemes')
    return (
        <div className={styles.loaderContainer}>
            <div className={styles.spinner}>
                <div />
                <div />
                <div />
                <div />
            </div>
            <span className={styles.loaderText}>{displayText}</span>
        </div>
    )
}
