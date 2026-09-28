import React, { useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import { desktopApi } from '@shared/desktop/desktopApi'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'

const LinuxAsarPathDialog: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen } = useModalContext()
    const [isSaving, setIsSaving] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    useEffect(() => {
        if (isModalOpen(Modals.LINUX_ASAR_PATH)) {
            setErrorMessage(null)
        }
    }, [Modals.LINUX_ASAR_PATH, isModalOpen])

    const handleClose = () => {
        if (isSaving) return
        closeModal(Modals.LINUX_ASAR_PATH)
    }

    const handleSelectPath = async () => {
        if (isSaving) return
        setIsSaving(true)

        try {
            setErrorMessage(null)
            const snapshot = await desktopApi.settings.getSnapshot()
            const storedPath = snapshot.settings.modSavePath as string | undefined
            const result = await desktopApi.music.selectLinuxAsarPath(storedPath)

            if (result.canceled) {
                return
            }

            if (!result.path) {
                const message = t('modals.linuxAsarPath.errors.missingAsar')
                setErrorMessage(message)
                toast.custom('error', t('modals.linuxAsarPath.toasts.errorTitle'), message)
                return
            }

            await desktopApi.settings.updatePreferences({ modSavePath: result.path })
            closeModal(Modals.LINUX_ASAR_PATH)
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <CustomModalPS
            allowNoChoice={false}
            isOpen={isModalOpen(Modals.LINUX_ASAR_PATH)}
            onClose={handleClose}
            title={t('modals.linuxAsarPath.title')}
            text={t('modals.linuxAsarPath.description')}
            subText={errorMessage || undefined}
            buttons={[
                {
                    text: t('modals.linuxAsarPath.buttons.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isSaving,
                },
                {
                    text: t('modals.linuxAsarPath.buttons.selectFolder'),
                    onClick: handleSelectPath,
                    variant: 'primary',
                    disabled: isSaving,
                },
            ]}
        />
    )
}

export default LinuxAsarPathDialog
