import React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'
import config from '@common/appConfig'

const PremiumPromoModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen } = useModalContext()

    const handleClose = () => {
        closeModal(Modals.PREMIUM_PROMO)
    }

    const openBoosty = () => {
        window.open(config.BOOSTY_PURCHASE_URL)
    }

    return (
        <CustomModalPS
            isOpen={isModalOpen(Modals.PREMIUM_PROMO)}
            onClose={handleClose}
            title={t('modals.premiumPromo.title')}
            text={t('modals.premiumPromo.description')}
            buttons={[
                {
                    text: t('modals.premiumPromo.ok'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
                {
                    text: t('modals.premiumPromo.subscribe'),
                    onClick: openBoosty,
                    variant: 'primary',
                },
            ]}
        />
    )
}

export default PremiumPromoModal
