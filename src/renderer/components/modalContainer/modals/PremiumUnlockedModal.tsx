import React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'

const PremiumUnlockedModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen } = useModalContext()

    const handleClose = () => {
        closeModal(Modals.PREMIUM_UNLOCKED)
    }

    return (
        <CustomModalPS
            isOpen={isModalOpen(Modals.PREMIUM_UNLOCKED)}
            onClose={handleClose}
            title={t('modals.premiumUnlocked.title')}
            text={t('modals.premiumUnlocked.description')}
            buttons={[
                {
                    text: t('modals.premiumUnlocked.ok'),
                    onClick: handleClose,
                    variant: 'primary',
                },
            ]}
        />
    )
}

export default PremiumUnlockedModal
