import { useTranslation } from 'react-i18next'

import { useLegacyAddonMigrationModal } from '@entities/addon/lib/useLegacyAddonMigrationModal'
import TooltipButton from '@shared/ui/tooltip_button'

import * as styles from '@entities/addon/ui/LegacyAddonRestrictionBadge.module.scss'

import type { MouseEvent } from 'react'

type Props = {
    className: string
}

export default function LegacyAddonRestrictionBadge({ className }: Props) {
    const { t } = useTranslation()
    const openMigrationModal = useLegacyAddonMigrationModal()

    const stopPropagation = (event: MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation()
    }

    return (
        <span className={styles.wrapper} onClick={stopPropagation}>
            <TooltipButton
                className={className}
                side="bottom"
                onClick={openMigrationModal}
                tooltipText={
                    <div className={styles.content}>
                        <div className={styles.title}>{t('extensions.legacyAddon.warningTitle')}</div>
                        <div className={styles.description}>{t('extensions.legacyAddon.warningDescription')}</div>
                        <div className={styles.action}>{t('extensions.legacyAddon.warningAction')}</div>
                    </div>
                }
            >
                LEGACY
            </TooltipButton>
        </span>
    )
}
