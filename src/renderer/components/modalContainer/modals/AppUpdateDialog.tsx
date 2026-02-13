import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MainEvents from '../../../../common/types/mainEvents'
import UserContext from '../../../api/context/user'
import CustomModalPS from '../../PSUI/CustomModalPS'

const AppUpdateDialog: React.FC = () => {
    const { t } = useTranslation()
    const { updateAvailable, setUpdate } = useContext(UserContext)
    const [isDismissed, setIsDismissed] = useState(false)

    useEffect(() => {
        if (!updateAvailable) {
            setIsDismissed(false)
        }
    }, [updateAvailable])

    const handleClose = () => {
        setIsDismissed(true)
    }

    const handleInstall = () => {
        setUpdate(false)
        window.desktopEvents?.send(MainEvents.UPDATE_INSTALL)
    }

    return (
        <CustomModalPS
            isOpen={Boolean(updateAvailable && !isDismissed)}
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

