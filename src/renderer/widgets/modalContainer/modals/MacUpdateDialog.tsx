import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import { desktopApi } from '@shared/desktop/desktopApi'

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
        const handleMacUpdateReady = (data: unknown) => {
            const updateData = data as MacUpdateInfo
            if (!updateData?.openPath) return
            setUpdateInfo(updateData)
            openModal(Modals.MAC_UPDATE_DIALOG)
        }

        const unsubscribe = desktopApi.system.onMacUpdateReady(handleMacUpdateReady)

        return () => {
            unsubscribe()
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
                    onClick: () => updateInfo?.openPath && desktopApi.system.openLastMacUpdatePath(),
                    variant: 'primary',
                    disabled: !updateInfo?.openPath,
                },
                {
                    text: t('modals.macUpdate.buttons.openApplications'),
                    onClick: () => desktopApi.system.openApplicationsDirectory(),
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
