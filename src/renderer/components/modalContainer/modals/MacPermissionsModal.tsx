import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import RendererEvents from '../../../../common/types/rendererEvents'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'
import MainEvents from '@common/types/mainEvents'

const MacPermissionsModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()

    useEffect(() => {
        const handleRequestMacPermissions = (_: any) => {
            openModal(Modals.MAC_PERMISSIONS_MODAL)
        }

        const unsubscribe = window.desktopEvents?.on(RendererEvents.REQUEST_MAC_PERMISSIONS, handleRequestMacPermissions)

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe()
            }
        }
    }, [Modals.MAC_PERMISSIONS_MODAL, openModal])

    const handleClose = useCallback(() => {
        closeModal(Modals.MAC_PERMISSIONS_MODAL)
    }, [Modals.MAC_PERMISSIONS_MODAL, closeModal])

    const handleOpenSettings = useCallback(() => {
        window.desktopEvents?.send(MainEvents.OPEN_PATH, 'privacySettings')
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
