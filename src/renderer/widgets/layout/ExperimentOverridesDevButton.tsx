import React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'
import { staticAsset } from '@shared/lib/staticAssets'

const ExperimentOverridesDevButton: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const label = t('header.devOverrides.open')

    return (
        <TooltipButton tooltipText={label} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button type="button" className={styles.headerIconButton} aria-label={label} onClick={() => openModal(Modals.EXPERIMENT_OVERRIDES_DEV)}>
                <img src={staticAsset('assets/icons/ui/header-json.svg')} alt="" aria-hidden="true" />
            </button>
        </TooltipButton>
    )
}

export default ExperimentOverridesDevButton
