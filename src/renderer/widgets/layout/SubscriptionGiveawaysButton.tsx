import React from 'react'
import { MdRedeem } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'

const SubscriptionGiveawaysButton: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()

    return (
        <TooltipButton tooltipText={t('header.giveaways.open')} dataSide={'top'} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button type="button" className={styles.headerIconButton} aria-label={t('header.giveaways.open')} onClick={() => openModal(Modals.SUBSCRIPTION_GIVEAWAYS)}>
                <MdRedeem size={18} />
            </button>
        </TooltipButton>
    )
}

export default SubscriptionGiveawaysButton
