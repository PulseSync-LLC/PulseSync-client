import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch, useSelector } from 'react-redux'
import MainEvents from '../../../../common/types/mainEvents'
import { closeLinuxAsarModal, setLinuxAsarPath } from '../../../api/store/modalSlice'
import { RootState } from '../../../api/store/store'
import CustomModalPS from '../../PSUI/CustomModalPS'

const LinuxAsarPathDialog: React.FC = () => {
    const { t } = useTranslation()
    const dispatch = useDispatch()
    const isOpen = useSelector((state: RootState) => state.modal.linuxAsarOpen)
    const [isSaving, setIsSaving] = useState(false)

    const handleClose = () => {
        if (isSaving) return
        dispatch(closeLinuxAsarModal())
    }

    const handleSelectPath = async () => {
        if (isSaving) return
        setIsSaving(true)

        try {
            const storedPath = window.electron?.store?.get?.('settings.modSavePath') as string | undefined
            const defaultPath = storedPath || '/opt/Яндекс Музыка'
            const selectedPath = await window.desktopEvents?.invoke(MainEvents.DIALOG_OPEN_DIRECTORY, {
                defaultPath,
            })

            if (selectedPath) {
                window.electron?.store?.set?.('settings.modSavePath', selectedPath)
                dispatch(setLinuxAsarPath(selectedPath))
                dispatch(closeLinuxAsarModal())
            }
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <CustomModalPS
            isOpen={isOpen}
            onClose={handleClose}
            title={t('layout.linuxAsarTitle')}
            text={t('layout.linuxAsarDescription')}
            buttons={[
                {
                    text: t('layout.linuxAsarSelectButton'),
                    onClick: handleSelectPath,
                    variant: 'primary',
                    disabled: isSaving,
                },
                {
                    text: t('common.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isSaving,
                },
            ]}
        />
    )
}

export default LinuxAsarPathDialog
