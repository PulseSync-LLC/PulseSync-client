import React from 'react'

import { useTranslation } from 'react-i18next'

import config from '@common/appConfig'

import AppNameLogo from '@shared/assets/icon/AppName.svg'

import styles from './browserDownloadBanner.module.scss'
import * as pageStyles from '@pages/auth/default/auth.module.scss'

const BrowserDownloadBanner = () => {
    const { t } = useTranslation()

    return (
        <main className={pageStyles.main_window}>
            <div className={pageStyles.spaceBackground} aria-hidden="true">
                <div className={pageStyles.stars1} />
                <div className={pageStyles.stars2} />
                <div className={pageStyles.stars3} />
                <div className={pageStyles.shootingStarsLayer}>
                    {[0, 1, 2].map(index => (
                        <div key={index} className={pageStyles.shootingStar} style={{ '--index': index } as React.CSSProperties} />
                    ))}
                </div>
            </div>

            <section className={pageStyles.container}>
                <div className={pageStyles.logoBlock}>
                    <svg className={pageStyles.logoIcon} viewBox="0 0 40 40" fill="currentColor" aria-hidden="true">
                        <path d="M20.6536 28.5839H40V40H20.6536V28.5839Z" />
                        <path d="M0 0H40V25.7143H17.7778V40H0V14.2857H22.2222V11.4286H0V0Z" />
                    </svg>
                    <div className={pageStyles.logoName}>
                        <AppNameLogo />
                    </div>
                </div>

                <a className={pageStyles.authButton} href={config.WEBSITE_URL}>
                    {t('browserDownload.action')}
                </a>

                <span className={`${pageStyles.terms} ${styles.description}`}>{t('browserDownload.description')}</span>
            </section>
        </main>
    )
}

export default BrowserDownloadBanner
