import React, { useEffect, useState } from 'react'
import CustomModalPS from '../../PSUI/CustomModalPS'
import toast from '../../toast'
import { useTranslation } from 'react-i18next'

const YandexMusicUpdateDialog: React.FC = () => {
    const { t } = useTranslation()
    const [showDialog, setShowDialog] = useState(false)
    const [isDismissed, setIsDismissed] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        if (isDismissed) return

        const handleShowDialog = () => {
            setShowDialog(true)
        }

        const checkYandexMusic = () => {
            handleShowDialog()
        }

        window.desktopEvents?.on('SHOW_YANDEX_MUSIC_UPDATE_DIALOG', checkYandexMusic)

        const handleDeleteResult = (event: any, data: any) => {
            if (data.success) {
                toast.custom('success', t('modals.yandexMusicUpdate.toasts.successTitle'), t('modals.yandexMusicUpdate.toasts.deleteSuccess'), { duration: 3000 })
            } else {
                toast.custom('error', t('modals.yandexMusicUpdate.toasts.errorTitle'), data.message || t('modals.yandexMusicUpdate.toasts.deleteFailed'), { duration: 3000 })
            }
            setIsDeleting(false)
        }

        window.desktopEvents?.on('DELETE_YANDEX_MUSIC_RESULT', handleDeleteResult)

        return () => {
            window.desktopEvents?.removeAllListeners('SHOW_YANDEX_MUSIC_UPDATE_DIALOG')
            window.desktopEvents?.removeAllListeners('DELETE_YANDEX_MUSIC_RESULT')
        }
    }, [isDismissed])

    const handleClose = () => {
        setShowDialog(false)
        setIsDismissed(true)
    }

    const handleDelete = async () => {
        setIsDeleting(true)
        const toastId = toast.custom('loading', t('modals.yandexMusicUpdate.toasts.deletingTitle'), t('modals.yandexMusicUpdate.toasts.deletingDescription'), { duration: 3000 })

        try {
            window.desktopEvents?.send('DELETE_YANDEX_MUSIC_APP')
        } catch (e) {
            setIsDeleting(false)
            toast.update(toastId, {
                kind: 'error',
                title: t('modals.yandexMusicUpdate.toasts.errorTitle'),
                msg: t('modals.yandexMusicUpdate.toasts.deleteStartFailed'),
                sticky: false,
                value: undefined,
            })
            handleClose()
        }
    }

    return (
        <CustomModalPS
            isOpen={showDialog}
            onClose={handleClose}
            title={t('modals.yandexMusicUpdate.title')}
            text={t('modals.yandexMusicUpdate.description')}
            subText={t('modals.yandexMusicUpdate.subText')}
            buttons={[
                {
                    text: t('modals.yandexMusicUpdate.buttons.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isDeleting,
                },
                {
                    text: t('modals.yandexMusicUpdate.buttons.delete'),
                    onClick: handleDelete,
                    variant: 'danger',
                    disabled: isDeleting,
                },
            ]}
        />
    )
}

export default YandexMusicUpdateDialog
