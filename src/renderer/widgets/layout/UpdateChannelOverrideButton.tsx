import React, { useCallback, useEffect, useState } from 'react'
import { MdAltRoute } from 'react-icons/md'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'

type UpdateStatus = 'IDLE' | 'CHECKING' | 'DOWNLOADING' | 'DOWNLOADED'

const UpdateChannelOverrideButton: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('IDLE')
    const isSwitchBlocked = updateStatus === 'CHECKING' || updateStatus === 'DOWNLOADING'
    const label = isSwitchBlocked ? t('header.updateChannel.busy') : t('header.updateChannel.open')

    const refreshStatus = useCallback(async () => {
        try {
            const nextStatus = (await window.desktopEvents.invoke(MainEvents.GET_UPDATE_STATUS)) as UpdateStatus
            setUpdateStatus(nextStatus ?? 'IDLE')
        } catch {
            setUpdateStatus('IDLE')
        }
    }, [])

    useEffect(() => {
        void refreshStatus()

        const handleCheckUpdate = (_event: unknown, data?: { checking?: boolean; updateAvailable?: boolean }) => {
            if (data?.checking) {
                setUpdateStatus('CHECKING')
                return
            }
            if (!data?.updateAvailable) {
                setUpdateStatus('IDLE')
            }
        }

        const handleDownloadProgress = () => setUpdateStatus('DOWNLOADING')
        const handleDownloadFinished = () => setUpdateStatus('DOWNLOADED')
        const handleDownloadFailed = () => setUpdateStatus('IDLE')

        const unsubscribers = [
            window.desktopEvents?.on(RendererEvents.CHECK_UPDATE, handleCheckUpdate),
            window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, handleDownloadProgress),
            window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FINISHED, handleDownloadFinished),
            window.desktopEvents?.on(RendererEvents.DOWNLOAD_UPDATE_FAILED, handleDownloadFailed),
        ].filter(Boolean) as Array<() => void>

        return () => {
            unsubscribers.forEach(unsubscribe => unsubscribe())
        }
    }, [refreshStatus])

    if (isSwitchBlocked) {
        return null
    }

    return (
        <TooltipButton tooltipText={label} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button type="button" className={styles.headerIconButton} aria-label={label} onClick={() => openModal(Modals.UPDATE_CHANNEL_OVERRIDE)}>
                <MdAltRoute size={18} />
            </button>
        </TooltipButton>
    )
}

export default UpdateChannelOverrideButton
