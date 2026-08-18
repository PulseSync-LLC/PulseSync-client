import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { HiQuestionMarkCircle } from 'react-icons/hi'
import { MdFolderOpen } from 'react-icons/md'

import { staticAsset } from '@shared/lib/staticAssets'
import ButtonV2 from '@shared/ui/buttonV2'
import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from './home.module.scss'

import type { HomeSecondaryComponent, HomeSecondaryComponentId } from '@pages/home/model/homeDashboard'

type Props = {
    items: HomeSecondaryComponent[]
    isObsInstalled: boolean
    isObsInstalling: boolean
    onInstallObsWidget: () => void
    onOpenObsWidgetFolder: () => void
}

const isMetadataBackedSubcomponent = (itemId: HomeSecondaryComponentId): boolean => {
    return itemId === 'ffmpeg' || itemId === 'ytdlp'
}

export default function HomeSecondaryComponentsSection({ items, isObsInstalled, isObsInstalling, onInstallObsWidget, onOpenObsWidgetFolder }: Props) {
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
                                <div className={styles.secondaryActions}>
                                    {isObsInstalled && (
                                        <ButtonV2
                                            type="button"
                                            className={styles.secondaryFolderButton}
                                            onClick={onOpenObsWidgetFolder}
                                            aria-label={t('contextMenu.obsWidget.openFolder')}
                                            title={t('contextMenu.obsWidget.openFolder')}
                                        >
                                            <MdFolderOpen aria-hidden="true" />
                                        </ButtonV2>
                                    )}
                                    <ButtonV2
                                        type="button"
                                        className={styles.secondaryActionButton}
                                        onClick={onInstallObsWidget}
                                        disabled={isObsInstalled || isObsInstalling}
                                    >
                                        {isObsInstalled
                                            ? t('pages.home.installed')
                                            : isObsInstalling
                                              ? t('common.loading')
                                              : t('layout.installAction')}
                                    </ButtonV2>
                                </div>
                            ) : isMetadataBackedSubcomponent(item.id) ? (
                                <TooltipButton
                                    side={'right'}
                                    tooltipText={t('pages.home.onDemandInstallHint')}
                                    as="div"
                                    className={styles.secondaryActionTooltip}
                                >
                                    <div className={styles.secondaryActionStatusLabel}>
                                        {item.version ? t('pages.home.installed') : t('pages.home.notInstalled')}
                                        <HiQuestionMarkCircle aria-hidden="true" />
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
