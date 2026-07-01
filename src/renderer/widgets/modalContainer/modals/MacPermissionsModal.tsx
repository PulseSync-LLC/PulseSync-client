import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import { desktopApi } from '@shared/desktop/desktopApi'

const MacPermissionsModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()

    useEffect(() => {
        const handleRequestMacPermissions = () => {
            openModal(Modals.MAC_PERMISSIONS_MODAL)
        }

        const unsubscribe = desktopApi.system.onMacPermissionsRequired(handleRequestMacPermissions)

        return () => {
            unsubscribe()
        }
    }, [Modals.MAC_PERMISSIONS_MODAL, openModal])

    const handleClose = useCallback(() => {
        closeModal(Modals.MAC_PERMISSIONS_MODAL)
    }, [Modals.MAC_PERMISSIONS_MODAL, closeModal])

    const handleOpenSettings = useCallback(() => {
        desktopApi.system.openPrivacySettings()
        closeModal(Modals.MAC_PERMISSIONS_MODAL)
    }, [Modals.MAC_PERMISSIONS_MODAL, closeModal])

    return (
        <CustomModalPS
            allowNoChoice={false}
            isOpen={isModalOpen(Modals.MAC_PERMISSIONS_MODAL)}
            onClose={handleClose}
            title={t('modals.macPermissions.title')}
            text={t('modals.macPermissions.description')}
            subText={t('modals.macPermissions.subText')}
            buttons={[
                {
                    text: t('modals.macPermissions.buttons.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
                {
                    text: t('modals.macPermissions.buttons.openSettings'),
                    onClick: handleOpenSettings,
                    variant: 'primary',
                },
            ]}
        />
    )
}

export default MacPermissionsModal
