import { useTranslation } from 'react-i18next'

import { staticAsset } from '@shared/lib/staticAssets'
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

export default function HomeSecondaryComponentsSection({ items, isObsInstalled, isObsInstalling, onInstallObsWidget }: Props) {
    const { t } = useTranslation()

    const getSecondaryVersionLabel = (itemId: string) => {
        if (itemId === 'obs-widget') {
            return undefined
        }

        if (itemId === 'ffmpeg' || itemId === 'yt-dlp') {
            return undefined
        }

        return t('common.notAvailable')
    }

    return (
        <section className={styles.panelHollow}>
            <h2 className={styles.panelTitle}>{t('pages.home.auxiliaryComponents')}</h2>
            <div className={styles.secondaryList}>
                {items.map(item => {

                    const secondaryVersionLabel = getSecondaryVersionLabel(item.id)

                    return (
                        <article className={styles.secondaryItem} key={item.id}>
                            <div className={styles.secondaryItemMain}>
                                <img className={styles.componentLogo} src={staticAsset(`assets/${item.iconAsset}`)} alt="" aria-hidden="true" />

                                <div className={styles.componentMeta}>
                                    <div className={styles.componentTitle}>{item.title}</div>
                                    {secondaryVersionLabel && <div className={styles.componentVersion}>{secondaryVersionLabel}</div>}
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
                            ) : item.id === 'ffmpeg' || item.id === 'yt-dlp' ? (
                                <TooltipButton
                                    side={'top'}
                                    dataSide={'bottom'}
                                    tooltipText={t('pages.home.onDemandInstallHint')}
                                    as="div"
                                    className={styles.secondaryActionTooltip}
                                >
                                    <ButtonV2 type="button" className={styles.secondaryActionButton} disabled>
                                        {t('pages.home.installed')}
                                    </ButtonV2>
                                </TooltipButton>
                            ) : (
                                <div className={styles.secondaryStatus}>{t('pages.home.installed')}</div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
