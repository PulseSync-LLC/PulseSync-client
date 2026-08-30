import { DropdownMenu, type DropdownMenuItem } from '@pulsesync/uikit/navigation'
import cn from 'clsx'
import { useTranslation } from 'react-i18next'
import { MdArticle, MdKeyboardArrowDown } from 'react-icons/md'

import { staticAsset } from '@shared/lib/staticAssets'
import ButtonV2 from '@shared/ui/buttonV2'
import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from './home.module.scss'

import type { HomePrimaryComponent } from '@pages/home/model/homeDashboard'

export type HomeBranchOption = {
    value: string
    label: string
    description?: string
    selected: boolean
    disabled?: boolean
}

export type HomeBranchPicker = {
    ariaLabel: string
    options: HomeBranchOption[]
    loading: boolean
    disabled?: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (value: string) => void
}

type Props = {
    items: HomePrimaryComponent[]
    versions: Record<string, string>
    branches: Partial<Record<'client' | 'mod', string>>
    branchPickers: Partial<Record<'client' | 'mod', HomeBranchPicker>>
    isModInstalled: boolean
    isModUpdateAvailable: boolean
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
    branches,
    branchPickers,
    isModInstalled,
    isModUpdateAvailable,
    isMusicInstalled,
    onWhatsNewClick,
    onCheckUpdatesClick,
}: Props) {
    const { t } = useTranslation()

    return (
        <section className={styles.panelHollow}>
            <h2 className={styles.panelTitle}>{t('pages.home.mainComponents')}</h2>
            <div className={styles.primaryList}>
                {items.map(item => {
                    const isModUpdateAction = item.id === 'mod' && isModUpdateAvailable
                    const branchPicker = item.id === 'music' ? undefined : branchPickers[item.id]
                    const branch = item.id === 'music' ? undefined : branches[item.id]
                    const branchMenuItems: DropdownMenuItem[] = branchPicker
                        ? branchPicker.loading
                            ? [
                                  {
                                      key: 'loading',
                                      label: t('pages.home.branchPickerLoading'),
                                      disabled: true,
                                  },
                              ]
                            : branchPicker.options.map(option => ({
                                  key: option.value,
                                  label: (
                                      <span className={styles.branchOptionLabel}>
                                          <span>{option.label}</span>
                                          {option.description && <span className={styles.branchOptionDescription}>{option.description}</span>}
                                      </span>
                                  ),
                                  radio: true,
                                  checked: option.selected,
                                  disabled: option.disabled,
                                  onClick: () => branchPicker.onSelect(option.value),
                              }))
                        : []

                    const versionContent = (
                        <>
                            <span>{versions[item.id]}</span>
                            {branch && (
                                <>
                                    <span className={styles.versionSeparator}>·</span>
                                    <span className={styles.componentBranch}>{branch}</span>
                                </>
                            )}
                        </>
                    )

                    return (
                        <article className={cn(styles.primaryItem, itemClassnameMap[item.id])} key={item.id}>
                            <img className={styles.componentLogo} src={staticAsset(`assets/${item.iconAsset}`)} alt="" aria-hidden="true" />

                            <div className={styles.componentMeta}>
                                <div className={styles.componentTitle}>{t(item.titleKey)}</div>
                                {branchPicker ? (
                                    <DropdownMenu
                                        items={branchMenuItems}
                                        className={styles.branchPicker}
                                        menuClassName={styles.branchPickerMenu}
                                        placement="bottom-start"
                                        onOpenChange={branchPicker.onOpenChange}
                                    >
                                        <button
                                            type="button"
                                            className={styles.componentVersionButton}
                                            disabled={branchPicker.disabled}
                                            aria-label={branchPicker.ariaLabel}
                                        >
                                            {versionContent}
                                            <MdKeyboardArrowDown className={styles.versionArrow} aria-hidden="true" />
                                        </button>
                                    </DropdownMenu>
                                ) : (
                                    <div className={styles.componentVersion}>{versionContent}</div>
                                )}
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
                                    <TooltipButton
                                        side="top"
                                        tooltipText={t('pages.home.whatsNew')}
                                        as="span"
                                        className={styles.primaryActionTooltip}
                                    >
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
                                        tooltipText={isModUpdateAction ? t('layout.updateAction') : t('contextMenu.misc.checkUpdates')}
                                        as="span"
                                        className={styles.primaryActionTooltip}
                                    >
                                        <ButtonV2
                                            type="button"
                                            className={cn(styles.actionButton, styles.updateButton)}
                                            onClick={() => onCheckUpdatesClick(item.id)}
                                            disabled={item.id === 'mod' && !isModInstalled}
                                            aria-label={isModUpdateAction ? t('layout.updateAction') : t('contextMenu.misc.checkUpdates')}
                                        >
                                            {isModUpdateAction ? t('layout.updateAction') : t('pages.home.checkUpdatesAction')}
                                        </ButtonV2>
                                    </TooltipButton>
                                </div>
                            )}
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
