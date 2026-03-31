import React from 'react'
import { MdAltRoute } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'

const UpdateChannelOverrideButton: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const label = t('header.updateChannel.open')

    return (
        <TooltipButton tooltipText={label} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button type="button" className={styles.headerIconButton} aria-label={label} onClick={() => openModal(Modals.UPDATE_CHANNEL_OVERRIDE)}>
                <MdAltRoute size={18} />
            </button>
        </TooltipButton>
    )
}

export default UpdateChannelOverrideButton
