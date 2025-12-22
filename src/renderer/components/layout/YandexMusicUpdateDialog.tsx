import React, { useEffect, useState } from 'react'
import CustomModalPS from '../PSUI/CustomModalPS'
import toast from '../toast'

const YandexMusicUpdateDialog: React.FC = () => {
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
                toast.custom('success', 'Готово', 'Яндекс Музыка успешно удалена', { duration: 3000 })
            } else {
                toast.custom('error', 'Ошибка', data.message || 'Не удалось удалить приложение', { duration: 3000 })
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
        const toastId = toast.custom('loading', 'Удаление...', 'Удаляю Яндекс Музыку из Microsoft Store', { duration: 3000 })

        try {
            window.desktopEvents?.send('DELETE_YANDEX_MUSIC_APP')
        } catch (e) {
            setIsDeleting(false)
            toast.update(toastId, {
                kind: 'error',
                title: 'Ошибка',
                msg: 'Не удалось запустить удаление приложения',
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
            title="Удаление Яндекс Музыки"
            text="У вас установлена устаревшая версия Яндекс Музыки из Microsoft Store. Это приложение будет удалено для корректной работы со всеми функциями."
            subText="Если вы согласны, приложение будет удалено. После этого вы сможете установить актуальную версию."
            buttons={[
                {
                    text: 'Удалить',
                    onClick: handleDelete,
                    variant: 'danger',
                    disabled: isDeleting,
                },
                {
                    text: 'Отмена',
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isDeleting,
                },
            ]}
        />
    )
}

export default YandexMusicUpdateDialog
