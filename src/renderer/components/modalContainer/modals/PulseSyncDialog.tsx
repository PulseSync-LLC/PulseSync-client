import React, { useEffect, useState } from 'react'
import MainEvents from '../../../../common/types/mainEvents'
import RendererEvents from '../../../../common/types/rendererEvents'
import toast from '../../toast'
import CustomModalPS from '../../PSUI/CustomModalPS'
import { useTranslation } from 'react-i18next'

type PulseSyncAddResult = { ok: true; message: string } | { ok: false; message: string }

const PulseSyncDialog: React.FC = () => {
    const { t } = useTranslation()
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
        const toastId = toast.custom('loading', t('pulseSyncDialog.addingTitle'), t('common.pleaseWait'), { duration: Infinity })

        try {
            const res = (await window.desktopEvents?.invoke(MainEvents.PULSESYNC_ADD_ENTRY as any)) as PulseSyncAddResult | undefined

            const ok = Boolean(res && (res as any).ok)
            const message = (res as any)?.message ?? (ok ? t('common.doneTitle') : t('pulseSyncDialog.addFailed'))

            toast.update(toastId, {
                kind: ok ? 'success' : 'error',
                title: ok ? t('common.doneTitle') : t('pulseSyncDialog.addFailedTitle'),
                msg: message,
                sticky: false,
                value: undefined,
            })
        } catch (e: any) {
            toast.update(toastId, {
                kind: 'error',
                title: t('common.errorTitle'),
                msg: e?.message ? String(e.message) : t('pulseSyncDialog.addFailed'),
                sticky: false,
                value: undefined,
            })
        } finally {
            setIsAdding(false)
            setShowDialog(false)
            setDialogPath(null)
        }
    }

    const text = t('pulseSyncDialog.description')

    const wrapPath = (path: string) => path.replace(/[\\/]/g, match => `${match}\u200B`)

    const subText = dialogPath
        ? t('pulseSyncDialog.subTextWithPath', { path: wrapPath(dialogPath) })
        : t('pulseSyncDialog.subText')

    return (
        <CustomModalPS
            isOpen={showDialog}
            onClose={handleClose}
            title={t('pulseSyncDialog.title')}
            text={text}
            subText={subText}
            buttons={[
                {
                    text: t('pulseSyncDialog.cancelButton'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isAdding,
                },
                {
                    text: isAdding ? t('pulseSyncDialog.addingButton') : t('pulseSyncDialog.confirmButton'),
                    onClick: handleConfirm,
                    variant: 'primary',
                    disabled: isAdding,
                },
            ]}
        />
    )
}

export default PulseSyncDialog
