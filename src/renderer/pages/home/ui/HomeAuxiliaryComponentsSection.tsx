import { useTranslation } from 'react-i18next'

import ButtonV2 from '@shared/ui/buttonV2'
import TooltipButton from '@shared/ui/tooltip_button'

import type { HomeSecondaryComponent } from '@pages/home/model/homeDashboard'

import * as styles from './home.module.scss'

type Props = {
    items: HomeSecondaryComponent[]
    isObsInstalled: boolean
    isObsInstalling: boolean
    onInstallObsWidget: () => void
}

export default function HomeAuxiliaryComponentsSection({ items, isObsInstalled, isObsInstalling, onInstallObsWidget }: Props) {
    const { t } = useTranslation()

    return (
        <section className={styles.panel}>
            <h2 className={styles.panelTitle}>{t('pages.home.auxiliaryComponents')}</h2>
            <div className={styles.secondaryList}>
                {items.map(item => (
                    <article className={styles.secondaryItem} key={item.id}>
                        <div className={styles.secondaryTitle}>{item.title}</div>
                        {item.id === 'obs-widget' ? (
                            <ButtonV2
                                type="button"
                                className={styles.secondaryActionButton}
                                onClick={onInstallObsWidget}
                                disabled={isObsInstalled || isObsInstalling}
                            >
                                {isObsInstalled ? t('pages.home.installed') : isObsInstalling ? t('common.loading') : t('layout.installAction')}
                            </ButtonV2>
                        ) : item.id === 'ffmpeg' || item.id === 'yt-dlp' ? (
                            <TooltipButton side={'top'} dataSide={'bottom'} tooltipText={t('pages.home.onDemandInstallHint')} as="div" className={styles.secondaryActionTooltip}>
                                <ButtonV2 type="button" className={styles.secondaryActionButton} disabled>
                                    {t('pages.home.installed')}
                                </ButtonV2>
                            </TooltipButton>
                        ) : (
                            <div className={styles.secondaryStatus}>{t('pages.home.installed')}</div>
                        )}
                    </article>
                ))}
            </div>
        </section>
    )
}
