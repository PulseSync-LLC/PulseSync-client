import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RendererEvents from '../../../../common/types/rendererEvents'
import CustomModalPS from '../../PSUI/CustomModalPS'
import MainEvents from '@common/types/mainEvents'

const MacPermissionsModal: React.FC = () => {
    const { t } = useTranslation()
    const [isModalOpen, setModalOpen] = useState(false)
    const isModalOpenRef = React.useRef(isModalOpen)

    useEffect(() => {
        const handleRequestMacPermissions = (_: any) => {
            if (!isModalOpenRef.current) {
                setModalOpen(true)
            }
        }

        window.desktopEvents?.on(RendererEvents.REQUEST_MAC_PERMISSIONS, handleRequestMacPermissions)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.REQUEST_MAC_PERMISSIONS)
        }
    }, [])

    useEffect(() => {
        isModalOpenRef.current = isModalOpen
    }, [isModalOpen])

    const handleClose = useCallback(() => {
        setModalOpen(false)
    }, [])

    const handleOpenSettings = useCallback(() => {
        window.desktopEvents?.send(MainEvents.OPEN_PATH, 'privacySettings')
        setModalOpen(false)
    }, [])

    return (
        <CustomModalPS
            allowNoChoice={false}
            isOpen={isModalOpen}
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
