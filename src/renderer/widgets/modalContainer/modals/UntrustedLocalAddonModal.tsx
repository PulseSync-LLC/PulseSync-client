import React from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import * as styles from '@widgets/modalContainer/modals/UntrustedLocalAddonModal.module.scss'

const UntrustedLocalAddonModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen, getModalState } = useModalContext()
    const { addonName, onConfirm } = getModalState(Modals.UNTRUSTED_LOCAL_ADDON_MODAL)

    const handleClose = () => {
        closeModal(Modals.UNTRUSTED_LOCAL_ADDON_MODAL)
    }

    const handleConfirm = () => {
        handleClose()
        onConfirm?.()
    }

    return (
        <CustomModalPS
            className={styles.modal}
            allowNoChoice={false}
            isOpen={isModalOpen(Modals.UNTRUSTED_LOCAL_ADDON_MODAL)}
            onClose={handleClose}
            buttons={[
                {
                    text: t('extensions.untrustedLocal.confirm'),
                    onClick: handleConfirm,
                },
                {
                    text: t('common.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
            ]}
        >
            <div className={styles.body}>
                <span className={styles.eyebrow}>{t('common.attentionTitle')}</span>
                <h2 className={styles.title}>{t('extensions.untrustedLocal.title')}</h2>
                <p className={styles.description}>{t('extensions.untrustedLocal.description', { name: addonName || t('store.unknownAddon') })}</p>
                <p className={styles.caption}>{t('extensions.untrustedLocal.caption')}</p>
            </div>
        </CustomModalPS>
    )
}

export default UntrustedLocalAddonModal
