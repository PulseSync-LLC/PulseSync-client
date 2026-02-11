import React, { useEffect, useState } from 'react'
import path from 'path'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import MainEvents from '../../../../common/types/mainEvents'
import RendererEvents from '../../../../common/types/rendererEvents'
import { closeLinuxAsarModal, setLinuxAsarPath } from '../../../api/store/modalSlice'
import { RootState } from '../../../api/store/store'
import CustomModalPS from '../../PSUI/CustomModalPS'
import toast from '../../toast'

const LinuxAsarPathDialog: React.FC = () => {
    const { t } = useTranslation()
    const dispatch = useDispatch()
    const isOpen = useSelector((state: RootState) => state.modal.linuxAsarOpen)
    const [isSaving, setIsSaving] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    useEffect(() => {
        if (isOpen) {
            setErrorMessage(null)
        }
    }, [isOpen])

    const handleClose = () => {
        if (isSaving) return
        dispatch(closeLinuxAsarModal())
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
                    const message = t('layout.linuxAsarMissingAsar')
                    setErrorMessage(message)
                    toast.custom('error', t('common.errorTitle'), message)
                    return
                }
                const resolvedPath = path.dirname(asarCandidates[foundIndex])
                window.electron?.store?.set?.('settings.modSavePath', resolvedPath)
                dispatch(setLinuxAsarPath(resolvedPath))
                dispatch(closeLinuxAsarModal())
            }
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <CustomModalPS
            allowNoChoice={false}
            isOpen={isOpen}
            onClose={handleClose}
            title={t('layout.linuxAsarTitle')}
            text={t('layout.linuxAsarDescription')}
            subText={errorMessage || undefined}
            buttons={[
                {
                    text: t('common.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isSaving,
                },
                {
                    text: t('layout.linuxAsarSelectButton'),
                    onClick: handleSelectPath,
                    variant: 'primary',
                    disabled: isSaving,
                },
            ]}
        />
    )
}

export default LinuxAsarPathDialog
