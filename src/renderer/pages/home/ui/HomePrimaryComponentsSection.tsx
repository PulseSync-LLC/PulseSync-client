import cn from 'clsx'
import { useTranslation } from 'react-i18next'

import { staticAsset } from '@shared/lib/staticAssets'
import ButtonV2 from '@shared/ui/buttonV2'

import type { HomePrimaryComponent } from '@pages/home/model/homeDashboard'

import * as styles from './home.module.scss'

type Props = {
    items: HomePrimaryComponent[]
    versions: Record<string, string>
    isModInstalled: boolean
    onWhatsNewClick: (componentId: string) => void
}

const itemClassnameMap = {
    mod: styles.modItem,
    client: styles.clientItem,
    music: styles.ymItem,
}

export default function HomePrimaryComponentsSection({ items, versions, isModInstalled, onWhatsNewClick }: Props) {
    const { t } = useTranslation()

    return (
        <section className={styles.panelHollow}>
            <h2 className={styles.panelTitle}>{t('pages.home.mainComponents')}</h2>
            <div className={styles.primaryList}>
                {items.map(item => (
                    <article className={cn(styles.primaryItem, itemClassnameMap[item.id])} key={item.id}>

                        <img className={styles.componentLogo} src={staticAsset(`assets/${item.iconAsset}`)} alt="" aria-hidden="true" />

                        <div className={styles.componentMeta}>
                            <div className={styles.componentTitle}>{t(item.titleKey)}</div>
                            <div className={styles.componentVersion}>{versions[item.id]}</div>
                        </div>

                        <ButtonV2
                            type="button"
                            className={styles.actionButton}
                            onClick={() => onWhatsNewClick(item.id)}
                            disabled={item.id === 'music' || (item.id === 'mod' && !isModInstalled)}
                        >
                            {t('pages.home.whatsNew')}
                        </ButtonV2>
                    </article>
                ))}
            </div>
        </section>
    )
}
