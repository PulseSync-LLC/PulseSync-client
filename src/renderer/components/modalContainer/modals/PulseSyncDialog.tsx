import React, { useEffect, useState } from 'react'
import MainEvents from '../../../../common/types/mainEvents'
import RendererEvents from '../../../../common/types/rendererEvents'
import { useModalContext } from '../../../api/context/modal'
import toast from '../../toast'
import CustomModalPS from '../../PSUI/CustomModalPS'
import { useTranslation } from 'react-i18next'

type PulseSyncAddResult = { ok: true; message: string } | { ok: false; message: string }

const PulseSyncDialog: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal, closeModal, isModalOpen } = useModalContext()
    const [dialogPath, setDialogPath] = useState<string | null>(null)
    const [isAdding, setIsAdding] = useState(false)

    useEffect(() => {
        const handleShowDialog = (_: any, data: { listGeneralPath?: string }) => {
            if (data?.listGeneralPath) {
                setDialogPath(data.listGeneralPath)
                openModal(Modals.PULSE_SYNC_DIALOG)
                setIsAdding(false)
            }
        }

        const pendingData = (window as any).__pendingPulseSyncData
        if (pendingData) {
            handleShowDialog(null, pendingData)
            ;(window as any).__pendingPulseSyncData = null
        }

        const unsubscribe = window.desktopEvents?.on(RendererEvents.SHOW_ADD_PULSESYNC_DIALOG, handleShowDialog)

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe()
            }
        }
    }, [Modals.PULSE_SYNC_DIALOG, openModal])

    const handleClose = () => {
        closeModal(Modals.PULSE_SYNC_DIALOG)
        setIsAdding(false)
        setDialogPath(null)
        window.desktopEvents?.send(MainEvents.PULSESYNC_DISMISS as any)
    }

    const handleConfirm = async () => {
        if (isAdding) return

        setIsAdding(true)
        const toastId = toast.custom('loading', t('modals.pulseSync.toasts.addingTitle'), t('modals.pulseSync.toasts.pleaseWait'), { duration: Infinity })

        try {
            const res = (await window.desktopEvents?.invoke(MainEvents.PULSESYNC_ADD_ENTRY as any)) as PulseSyncAddResult | undefined

            const ok = Boolean(res && (res as any).ok)
            const message = (res as any)?.message ?? (ok ? t('modals.pulseSync.toasts.successTitle') : t('modals.pulseSync.toasts.addFailed'))

            toast.update(toastId, {
                kind: ok ? 'success' : 'error',
                title: ok ? t('modals.pulseSync.toasts.successTitle') : t('modals.pulseSync.toasts.addFailedTitle'),
                msg: message,
                sticky: false,
                value: undefined,
            })
        } catch (e: any) {
            toast.update(toastId, {
                kind: 'error',
                title: t('modals.pulseSync.toasts.errorTitle'),
                msg: e?.message ? String(e.message) : t('modals.pulseSync.toasts.addFailed'),
                sticky: false,
                value: undefined,
            })
        } finally {
            setIsAdding(false)
            closeModal(Modals.PULSE_SYNC_DIALOG)
            setDialogPath(null)
        }
    }

    const text = t('modals.pulseSync.description')

    const wrapPath = (path: string) => path.replace(/[\\/]/g, match => `${match}\u200B`)

    const subText = dialogPath
        ? t('modals.pulseSync.subTextWithPath', { path: wrapPath(dialogPath) })
        : t('modals.pulseSync.subText')

    return (
        <CustomModalPS
            isOpen={isModalOpen(Modals.PULSE_SYNC_DIALOG)}
            onClose={handleClose}
            title={t('modals.pulseSync.title')}
            text={text}
            subText={subText}
            buttons={[
                {
                    text: t('modals.pulseSync.buttons.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: isAdding,
                },
                {
                    text: isAdding ? t('modals.pulseSync.buttons.adding') : t('modals.pulseSync.buttons.confirm'),
                    onClick: handleConfirm,
                    variant: 'primary',
                    disabled: isAdding,
                },
            ]}
        />
    )
}

export default PulseSyncDialog
