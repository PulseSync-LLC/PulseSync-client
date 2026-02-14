import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MainEvents from '@common/types/mainEvents'
import { useModalContext } from '../../../api/context/modal'
import CustomModalPS from '../../PSUI/CustomModalPS'
import toast from '../../toast'

const LinuxPermissionsModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, closeModal, isModalOpen } = useModalContext()
    const [isApplying, setIsApplying] = useState(false)

    const handleClose = useCallback(() => {
        if (isApplying) return
        closeModal(Modals.LINUX_PERMISSIONS_MODAL)
    }, [Modals.LINUX_PERMISSIONS_MODAL, closeModal, isApplying])

    const handleApplyPermissions = useCallback(async () => {
        if (isApplying) return
        setIsApplying(true)
        try {
            const result = await window.desktopEvents?.invoke(MainEvents.FIX_LINUX_MUSIC_PERMISSIONS)
            if (result?.success) {
                toast.custom(
                    'success',
                    t('modals.linuxPermissions.toasts.successTitle'),
                    t('modals.linuxPermissions.toasts.successDescription'),
                )
                closeModal(Modals.LINUX_PERMISSIONS_MODAL)
                return
            }

            const message = result?.error || t('layout.unknownError')
            toast.custom('error', t('modals.linuxPermissions.toasts.errorTitle'), t('modals.linuxPermissions.toasts.applyFailed', { message }))
        } catch (error: any) {
            toast.custom(
                'error',
                t('modals.linuxPermissions.toasts.errorTitle'),
                t('modals.linuxPermissions.toasts.applyFailed', { message: error?.message || t('layout.unknownError') }),
            )
        } finally {
            setIsApplying(false)
        }
    }, [Modals.LINUX_PERMISSIONS_MODAL, closeModal, isApplying, t])

    if (!window.electron.isLinux()) {
        return null
    }

    return (
        <CustomModalPS
            allowNoChoice={false}
            isOpen={isModalOpen(Modals.LINUX_PERMISSIONS_MODAL)}
            onClose={handleClose}
            title={t('modals.linuxPermissions.title')}
            text={t('modals.linuxPermissions.description')}
            subText={t('modals.linuxPermissions.subText')}
            buttons={[
                {
                    text: t('modals.linuxPermissions.buttons.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isApplying,
                },
                {
                    text: t('modals.linuxPermissions.buttons.fixPermissions'),
                    onClick: handleApplyPermissions,
                    variant: 'primary',
                    disabled: isApplying,
                },
            ]}
        />
    )
}

export default LinuxPermissionsModal
