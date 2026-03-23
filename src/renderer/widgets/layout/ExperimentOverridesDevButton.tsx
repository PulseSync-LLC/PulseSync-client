import React from 'react'
import { MdOutlineScience } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useExperiments } from '@app/providers/experiments'
import { useModalContext } from '@app/providers/modal'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'

const ExperimentOverridesDevButton: React.FC = () => {
    const { t } = useTranslation()
    const { localOverrides } = useExperiments()
    const { Modals, openModal } = useModalContext()
    const activeOverrideCount = Object.keys(localOverrides).length
    const label = t('header.devOverrides.open')

    return (
        <TooltipButton tooltipText={label} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button type="button" className={styles.headerIconButton} aria-label={label} onClick={() => openModal(Modals.EXPERIMENT_OVERRIDES_DEV)}>
                <MdOutlineScience size={18} />
            </button>
            {activeOverrideCount > 0 && <span className={styles.devOverridesBadge}>{activeOverrideCount}</span>}
        </TooltipButton>
    )
}

export default ExperimentOverridesDevButton
