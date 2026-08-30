import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdArticle, MdRefresh } from 'react-icons/md'

import { staticAsset } from '@shared/lib/staticAssets'
import ButtonV2 from '@shared/ui/buttonV2'
import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from './home.module.scss'

import type { HomePrimaryComponent } from '@pages/home/model/homeDashboard'

type Props = {
    items: HomePrimaryComponent[]
    versions: Record<string, string>
    isModInstalled: boolean
    isMusicInstalled: boolean
    onWhatsNewClick: (componentId: string) => void
    onCheckUpdatesClick: (componentId: string) => void
}

const itemClassnameMap = {
    mod: styles.modItem,
    client: styles.clientItem,
    music: styles.ymItem,
}

export default function HomePrimaryComponentsSection({
    items,
    versions,
    isModInstalled,
    isMusicInstalled,
    onWhatsNewClick,
    onCheckUpdatesClick,
}: Props) {
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

                        {item.id === 'music' ? (
                            <ButtonV2
                                type="button"
                                className={styles.actionButton}
                                onClick={() => onWhatsNewClick(item.id)}
                                disabled={!isMusicInstalled}
                            >
                                <MdArticle aria-hidden="true" style={{ width: '20px', height: '20px' }} />
                                {t('pages.home.whatsNew')}
                            </ButtonV2>
                        ) : (
                            <div className={styles.primaryActions}>
                                <TooltipButton side="top" tooltipText={t('pages.home.whatsNew')} as="span" className={styles.primaryActionTooltip}>
                                    <ButtonV2
                                        type="button"
                                        className={styles.changelogButton}
                                        onClick={() => onWhatsNewClick(item.id)}
                                        disabled={item.id === 'mod' && !isModInstalled}
                                        aria-label={t('pages.home.whatsNew')}
                                    >
                                        <MdArticle aria-hidden="true" />
                                    </ButtonV2>
                                </TooltipButton>
                                <TooltipButton
                                    side="top"
                                    tooltipText={t('contextMenu.misc.checkUpdates')}
                                    as="span"
                                    className={styles.primaryActionTooltip}
                                >
                                    <ButtonV2
                                        type="button"
                                        className={cn(styles.actionButton, styles.updateButton)}
                                        onClick={() => onCheckUpdatesClick(item.id)}
                                        disabled={item.id === 'mod' && !isModInstalled}
                                        aria-label={t('contextMenu.misc.checkUpdates')}
                                    >
                                        <MdRefresh aria-hidden="true" />
                                        {t('pages.home.checkUpdatesAction')}
                                    </ButtonV2>
                                </TooltipButton>
                            </div>
                        )}
                    </article>
                ))}
            </div>
        </section>
    )
}
