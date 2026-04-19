import { useTranslation } from 'react-i18next'

import { staticAsset } from '@shared/lib/staticAssets'
import ButtonV2 from '@shared/ui/buttonV2'
import TooltipButton from '@shared/ui/tooltip_button'

import type { HomeSecondaryComponent, HomeSecondaryComponentId } from '@pages/home/model/homeDashboard'

import * as styles from './home.module.scss'
import cn from 'clsx'

type Props = {
    items: HomeSecondaryComponent[]
    isObsInstalled: boolean
    isObsInstalling: boolean
    onInstallObsWidget: () => void
}

const isMetadataBackedSubcomponent = (itemId: HomeSecondaryComponentId): boolean => {
    return itemId === 'ffmpeg' || itemId === 'ytdlp'
}

export default function HomeSecondaryComponentsSection({ items, isObsInstalled, isObsInstalling, onInstallObsWidget }: Props) {
    const { t } = useTranslation()

    return (
        <section className={styles.panelHollow}>
            <h2 className={styles.panelTitle}>{t('pages.home.auxiliaryComponents')}</h2>
            <div className={styles.secondaryList}>
                {items.map(item => {
                    return (
                        <article className={styles.secondaryItem} key={item.id}>
                            <div className={styles.secondaryItemMain}>
                                <img className={styles.componentLogo} src={staticAsset(`assets/${item.iconAsset}`)} alt="" aria-hidden="true" />

                                <div className={styles.componentMeta}>
                                    <div className={styles.componentTitle}>{item.title}</div>
                                    {item.version && (
                                        <div className={cn(styles.componentVersion, styles.animatedComponentVersion)}>{item.version}</div>
                                    )}
                                </div>
                            </div>
                            {item.id === 'obs-widget' ? (
                                <ButtonV2
                                    type="button"
                                    className={styles.secondaryActionButton}
                                    onClick={onInstallObsWidget}
                                    disabled={isObsInstalled || isObsInstalling}
                                >
                                    {isObsInstalled ? t('pages.home.installed') : isObsInstalling ? t('common.loading') : t('layout.installAction')}
                                </ButtonV2>
                            ) : isMetadataBackedSubcomponent(item.id) ? (
                                <TooltipButton
                                    side={'top'}
                                    dataSide={'bottom'}
                                    tooltipText={t('pages.home.onDemandInstallHint')}
                                    as="div"
                                    className={styles.secondaryActionTooltip}
                                >
                                    <div className={styles.secondaryActionStatusLabel}>
                                        {item.version ? t('pages.home.installed') : t('pages.home.notInstalled')}
                                    </div>
                                </TooltipButton>
                            ) : (
                                <div className={styles.secondaryStatus}>{t('pages.home.notInstalled')}</div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
