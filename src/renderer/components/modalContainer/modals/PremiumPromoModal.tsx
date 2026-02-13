import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import { closePremiumPromoModal } from '../../../api/store/modalSlice'
import { RootState } from '../../../api/store/store'
import CustomModalPS from '../../PSUI/CustomModalPS'

const boostyUrl = 'https://boosty.to/evt/purchase/2634425'
const PremiumPromoModal: React.FC = () => {
    const { t } = useTranslation()
    const dispatch = useDispatch()
    const isOpen = useSelector((state: RootState) => state.modal.premiumPromoModalOpen)

    const handleClose = () => {
        dispatch(closePremiumPromoModal())
    }

    const openBoosty = () => {
        window.open(boostyUrl);
    }

    return (
        <CustomModalPS
            isOpen={isOpen}
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
