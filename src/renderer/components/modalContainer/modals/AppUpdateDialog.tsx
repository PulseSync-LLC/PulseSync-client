import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MainEvents from '../../../../common/types/mainEvents'
import UserContext from '../../../api/context/user'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'

const AppUpdateDialog: React.FC = () => {
    const { t } = useTranslation()
    const { updateAvailable, setUpdate } = useContext(UserContext)
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()
    const [isDismissed, setIsDismissed] = useState(false)

    useEffect(() => {
        if (!updateAvailable) {
            setIsDismissed(false)
        }
    }, [updateAvailable])

    useEffect(() => {
        if (updateAvailable && !isDismissed) {
            openModal(Modals.APP_UPDATE_DIALOG)
            return
        }
        closeModal(Modals.APP_UPDATE_DIALOG)
    }, [Modals.APP_UPDATE_DIALOG, closeModal, isDismissed, openModal, updateAvailable])

    const handleClose = () => {
        setIsDismissed(true)
        closeModal(Modals.APP_UPDATE_DIALOG)
    }

    const handleInstall = () => {
        setUpdate(false)
        closeModal(Modals.APP_UPDATE_DIALOG)
        window.desktopEvents?.send(MainEvents.UPDATE_INSTALL)
    }

    return (
        <CustomModalPS
            isOpen={Boolean(updateAvailable && !isDismissed) && isModalOpen(Modals.APP_UPDATE_DIALOG)}
            onClose={handleClose}
            title={t('modals.appUpdate.title')}
            text={t('modals.appUpdate.description')}
            buttons={[
                {
                    text: t('modals.appUpdate.buttons.later'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
                {
                    text: t('modals.appUpdate.buttons.install'),
                    onClick: handleInstall,
                    variant: 'primary',
                },
            ]}
        />
    )
}

export default AppUpdateDialog

