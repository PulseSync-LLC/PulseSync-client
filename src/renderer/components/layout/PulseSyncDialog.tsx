import React, { useEffect, useState } from 'react'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import toast from '../toast'
import CustomModalPS from '../PSUI/CustomModalPS'

type PulseSyncAddResult = { ok: true; message: string } | { ok: false; message: string }

const PulseSyncDialog: React.FC = () => {
    const [showDialog, setShowDialog] = useState(false)
    const [dialogPath, setDialogPath] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)

    useEffect(() => {
        const handleShowDialog = (_: any, data: { listGeneralPath?: string }) => {
            if (data?.listGeneralPath) {
                setDialogPath(data.listGeneralPath)
                setShowDialog(true)
                setIsAdding(false)
            }
        }

        const pendingData = (window as any).__pendingPulseSyncData
        if (pendingData) {
            handleShowDialog(null, pendingData)
            ;(window as any).__pendingPulseSyncData = null
        }

        window.desktopEvents?.on(RendererEvents.SHOW_ADD_PULSESYNC_DIALOG, handleShowDialog)

        return () => {
            window.desktopEvents?.removeAllListeners(RendererEvents.SHOW_ADD_PULSESYNC_DIALOG)
        }
    }, [])

    const handleClose = () => {
        setShowDialog(false)
        setIsAdding(false)
        setDialogPath(null)
        window.desktopEvents?.send(MainEvents.PULSESYNC_DISMISS as any)
    }

    const handleConfirm = async () => {
        if (isAdding) return

        setIsAdding(true)
        const toastId = toast.custom('loading', 'Добавляю записи...', 'Ожидайте...', { duration: Infinity })

        try {
            const res = (await window.desktopEvents?.invoke(MainEvents.PULSESYNC_ADD_ENTRY as any)) as PulseSyncAddResult | undefined

            const ok = Boolean(res && (res as any).ok)
            const message = (res as any)?.message ?? (ok ? 'Готово' : 'Не удалось добавить записи')

            toast.update(toastId, {
                kind: ok ? 'success' : 'error',
                title: ok ? 'Готово' : 'Не получилось',
                msg: message,
                sticky: false,
                value: undefined,
            })
        } catch (e: any) {
            toast.update(toastId, {
                kind: 'error',
                title: 'Ошибка',
                msg: e?.message ? String(e.message) : 'Не удалось добавить записи',
                sticky: false,
                value: undefined,
            })
        } finally {
            setIsAdding(false)
            setShowDialog(false)
            setDialogPath(null)
        }
    }

    const text =
        'Если вы испытываете трудности с доступностью PulseSync (приложение не подключается, долго загружается или работает нестабильно), можно добавить домены в конфиг zapret.'

    const subText = dialogPath
        ? `Файл конфигурации: ${dialogPath}. Записи pulsesync.dev там сейчас нет. Добавить автоматически?`
        : 'Записи pulsesync.dev сейчас нет. Добавить автоматически?'

    return (
        <CustomModalPS
            isOpen={showDialog}
            onClose={handleClose}
            title="Обнаружен запущенный zapret"
            text={text}
            subText={subText}
            buttons={[
                {
                    text: isAdding ? 'Добавляю…' : 'Да, добавить',
                    onClick: handleConfirm,
                    variant: 'primary',
                    disabled: isAdding,
                },
                {
                    text: 'Нет',
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isAdding,
                },
            ]}
        />
    )
}

export default PulseSyncDialog
