import React, { useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useModalContext } from '@app/providers/modal'
import { desktopApi } from '@shared/desktop/desktopApi'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import toast from '@shared/ui/toast'

const YandexMusicUpdateDialog: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()
    const [isDismissed, setIsDismissed] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        if (isDismissed) return

        const handleShowDialog = () => {
            openModal(Modals.YANDEX_MUSIC_UPDATE_DIALOG)
        }

        const checkYandexMusic = () => {
            handleShowDialog()
        }

        const unsubscribeShowDialog = desktopApi.music.onYandexMusicUpdateRequired(checkYandexMusic)

        const handleDeleteResult = (data: { message?: string; success: boolean }) => {
            if (data.success) {
                toast.custom('success', t('modals.yandexMusicUpdate.toasts.successTitle'), t('modals.yandexMusicUpdate.toasts.deleteSuccess'), {
                    duration: 3000,
                })
            } else {
                toast.custom(
                    'error',
                    t('modals.yandexMusicUpdate.toasts.errorTitle'),
                    data.message || t('modals.yandexMusicUpdate.toasts.deleteFailed'),
                    { duration: 3000 },
                )
            }
            setIsDeleting(false)
        }

        const unsubscribeDeleteResult = desktopApi.music.onYandexMusicDeleteResult(handleDeleteResult)

        return () => {
            if (typeof unsubscribeShowDialog === 'function') {
                unsubscribeShowDialog()
            }
            if (typeof unsubscribeDeleteResult === 'function') {
                unsubscribeDeleteResult()
            }
        }
    }, [Modals.YANDEX_MUSIC_UPDATE_DIALOG, isDismissed, openModal])

    const handleClose = () => {
        closeModal(Modals.YANDEX_MUSIC_UPDATE_DIALOG)
        setIsDismissed(true)
    }

    const handleDelete = async () => {
        setIsDeleting(true)
        const toastId = toast.custom(
            'loading',
            t('modals.yandexMusicUpdate.toasts.deletingTitle'),
            t('modals.yandexMusicUpdate.toasts.deletingDescription'),
            { duration: 3000 },
        )

        try {
            desktopApi.music.deleteYandexMusicApp()
        } catch {
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
            isOpen={isModalOpen(Modals.YANDEX_MUSIC_UPDATE_DIALOG)}
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
