import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RendererEvents from '../../../../common/types/rendererEvents'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'
import MainEvents from '../../../../common/types/mainEvents'

type MacUpdateInfo = {
    type: 'dmg' | 'zip'
    openPath: string
    appBundlePath?: string | null
}

const MacUpdateDialog: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()
    const [updateInfo, setUpdateInfo] = useState<MacUpdateInfo | null>(null)

    useEffect(() => {
        const handleMacUpdateReady = (_: any, data: MacUpdateInfo) => {
            setUpdateInfo(data)
            openModal(Modals.MAC_UPDATE_DIALOG)
        }

        const unsubscribe = window.desktopEvents?.on(RendererEvents.MAC_UPDATE_READY, handleMacUpdateReady)

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe()
            }
        }
    }, [Modals.MAC_UPDATE_DIALOG, openModal])

    const handleClose = () => {
        closeModal(Modals.MAC_UPDATE_DIALOG)
        setUpdateInfo(null)
    }

    const description = useMemo(() => {
        if (updateInfo?.type === 'zip') return t('modals.macUpdate.description.zip')
        return t('modals.macUpdate.description.dmg')
    }, [t, updateInfo?.type])

    return (
        <CustomModalPS
            isOpen={isModalOpen(Modals.MAC_UPDATE_DIALOG)}
            onClose={handleClose}
            title={t('modals.macUpdate.title')}
            text={description}
            buttons={[
                {
                    text: t('modals.macUpdate.buttons.openFinder'),
                    onClick: () =>
                        updateInfo?.openPath && window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'openPath', path: updateInfo.openPath }),
                    variant: 'primary',
                    disabled: !updateInfo?.openPath,
                },
                {
                    text: t('modals.macUpdate.buttons.openApplications'),
                    onClick: () => window.desktopEvents?.send(MainEvents.OPEN_PATH, { action: 'openApplications' }),
                    variant: 'secondary',
                },
                {
                    text: t('modals.macUpdate.buttons.done'),
                    onClick: handleClose,
                    variant: 'secondary',
                },
            ]}
        />
    )
}

export default MacUpdateDialog
