import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@app/providers/modal'
import TooltipButton from '@shared/ui/tooltip_button'
import * as styles from '@widgets/layout/header.module.scss'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'

type UpdateStatus = 'IDLE' | 'CHECKING' | 'DOWNLOADING' | 'DOWNLOADED'

const UpdateChannelOverrideButton: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, openModal } = useModalContext()
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('IDLE')
    const isSwitchBlocked = updateStatus === 'CHECKING' || updateStatus === 'DOWNLOADING'
    const label = isSwitchBlocked ? t('header.updateChannel.busy') : t('header.updateChannel.open')

    const refreshStatus = useCallback(async () => {
        try {
            const nextStatus = (await desktopApi.updates.getStatus()) as UpdateStatus
            setUpdateStatus(nextStatus ?? 'IDLE')
        } catch {
            setUpdateStatus('IDLE')
        }
    }, [])

    useEffect(() => {
        void refreshStatus()

        const handleCheckUpdate = (data?: { checking?: boolean; updateAvailable?: boolean }) => {
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
            desktopApi.updates.onCheck(payload => handleCheckUpdate(payload as { checking?: boolean; updateAvailable?: boolean })),
            desktopApi.updates.onDownloadProgress(handleDownloadProgress),
            desktopApi.updates.onDownloadFinished(handleDownloadFinished),
            desktopApi.updates.onDownloadFailed(handleDownloadFailed),
        ]

        return () => {
            unsubscribers.forEach(unsubscribe => unsubscribe())
        }
    }, [refreshStatus])

    return (
        <TooltipButton tooltipText={label} side="bottom" as="div" className={styles.devOverridesTrigger}>
            <button
                disabled={isSwitchBlocked}
                type="button"
                className={styles.headerIconButton}
                aria-label={label}
                onClick={() => openModal(Modals.UPDATE_CHANNEL_OVERRIDE)}
            >
                <img src={staticAsset('assets/icons/v4/header-routing.png')} alt="" aria-hidden="true" />
            </button>
        </TooltipButton>
    )
}

export default UpdateChannelOverrideButton
