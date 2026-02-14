import React, { useEffect, useState } from 'react'
import path from 'path'
import { useTranslation } from 'react-i18next'
import MainEvents from '../../../../common/types/mainEvents'
import RendererEvents from '../../../../common/types/rendererEvents'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'
import toast from '../../toast'

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
            const storedPath = window.electron?.store?.get?.('settings.modSavePath') as string | undefined
            const defaultPath = storedPath || '/opt/Яндекс Музыка'
            const selectedPath = await window.desktopEvents?.invoke(MainEvents.DIALOG_OPEN_DIRECTORY, {
                defaultPath,
            })

            if (selectedPath) {
                const asarCandidates = [path.join(selectedPath, 'app.asar'), path.join(selectedPath, 'resources', 'app.asar')]
                const checkResults = await Promise.all(
                    asarCandidates.map(candidate => window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.CHECK_FILE_EXISTS, candidate)),
                )
                const foundIndex = checkResults.findIndex(Boolean)
                if (foundIndex === -1) {
                    const message = t('modals.linuxAsarPath.errors.missingAsar')
                    setErrorMessage(message)
                    toast.custom('error', t('modals.linuxAsarPath.toasts.errorTitle'), message)
                    return
                }
                const resolvedPath = path.dirname(asarCandidates[foundIndex])
                window.electron?.store?.set?.('settings.modSavePath', resolvedPath)
                closeModal(Modals.LINUX_ASAR_PATH)
            }
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
