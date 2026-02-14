import React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'

const boostyUrl = 'https://boosty.to/evt/purchase/2634425'
const PremiumPromoModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen } = useModalContext()

    const handleClose = () => {
        closeModal(Modals.PREMMIUM_PROMO)
    }

    const openBoosty = () => {
        window.open(boostyUrl)
    }

    return (
        <CustomModalPS
            isOpen={isModalOpen(Modals.PREMMIUM_PROMO)}
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
