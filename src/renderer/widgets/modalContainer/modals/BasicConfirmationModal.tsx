import React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'

const BasicConfirmationModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen, getModalState } = useModalContext()
    const { onConfirm, confirmLabel, title, description, confirmVariant } = getModalState(Modals.BASIC_CONFIRMATION)

    const handleClose = () => {
        closeModal(Modals.BASIC_CONFIRMATION)
    }

    const handleConfirm = () => {
        onConfirm?.()
        closeModal(Modals.BASIC_CONFIRMATION)
    }

    return (
        <CustomModalPS
            isOpen={isModalOpen(Modals.BASIC_CONFIRMATION)}
            onClose={handleClose}
            title={title || t('modals.basicConfirmation.defaultTitle')}
            text={description || t('modals.basicConfirmation.defaultDescription')}
            buttons={[
                {
                    text: t('modals.basicConfirmation.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
                {
                    text: confirmLabel ?? t('modals.basicConfirmation.confirm'),
                    onClick: handleConfirm,
                    variant: confirmVariant ?? 'primary',
                },
            ]}
        />
    )
}

export default BasicConfirmationModal
