import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MainEvents from '../../../../common/types/mainEvents'
import UserContext from '../../../api/context/user.context'
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
            title={t('updates.readyTitle')}
            text={t('updates.readyDescription')}
            buttons={[
                {
                    text: t('updates.installButton'),
                    onClick: handleInstall,
                    variant: 'primary',
                },
                {
                    text: t('common.thinkLater'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
            ]}
        />
    )
}

export default AppUpdateDialog
