import { useTranslation } from 'react-i18next'

import * as styles from './home.module.scss'

export default function HomeNewsSection() {
    const { t } = useTranslation()

    return (
        <section className={`${styles.panel} ${styles.newsPanel}`}>
            <h2 className={styles.panelTitle}>{t('pages.home.news')}</h2>
            <div className={styles.newsBody} />
        </section>
    )
}
