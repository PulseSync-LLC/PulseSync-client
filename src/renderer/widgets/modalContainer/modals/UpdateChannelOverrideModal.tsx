import React, { useCallback, useEffect, useMemo, useState } from 'react'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import toast from '@shared/ui/toast'
import { useModalContext } from '@app/providers/modal'
import { useTranslation } from 'react-i18next'
import { IoCloseSharp } from 'react-icons/io5'
import * as styles from '@widgets/modalContainer/modals/UpdateChannelOverrideModal.module.scss'
import { desktopApi } from '@shared/desktop/desktopApi'
import { CLIENT_EXPERIMENTS, useExperiments } from '@app/providers/experiments'

type UpdateChannel = 'beta' | 'dev'
type ChannelSelection = UpdateChannel | 'default'
type UpdateStatus = 'IDLE' | 'CHECKING' | 'DOWNLOADING' | 'DOWNLOADED'

type ChannelStateResponse = {
    buildChannel: UpdateChannel
    overrideChannel: UpdateChannel | null
    effectiveChannel: UpdateChannel
}

const EMPTY_STATE: ChannelStateResponse = {
    buildChannel: 'beta',
    overrideChannel: null,
    effectiveChannel: 'beta',
}

const UpdateChannelOverrideModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, isModalOpen, closeModal } = useModalContext()
    const { isExperimentEnabled, loading: experimentsLoading } = useExperiments()
    const [channelState, setChannelState] = useState<ChannelStateResponse>(EMPTY_STATE)
    const [selection, setSelection] = useState<ChannelSelection>('default')
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('IDLE')

    const isOpen = isModalOpen(Modals.UPDATE_CHANNEL_OVERRIDE)
    const isSwitchBlocked = updateStatus === 'CHECKING' || updateStatus === 'DOWNLOADING'
    const allowDevToBetaSwitch = !experimentsLoading && isExperimentEnabled(CLIENT_EXPERIMENTS.ClientDevToBetaSwitch, false)

    const loadState = useCallback(async () => {
        setLoading(true)

        try {
            const [buildChannel, effectiveChannel, overrideChannel, currentUpdateStatus] = await Promise.all([
                desktopApi.updates.getBuildChannel(),
                desktopApi.updates.getEffectiveChannel(),
                desktopApi.updates.getChannelOverride(),
                desktopApi.updates.getStatus(),
            ])

            const nextState: ChannelStateResponse = {
                buildChannel: buildChannel as UpdateChannel,
                effectiveChannel: effectiveChannel as UpdateChannel,
                overrideChannel: overrideChannel as UpdateChannel | null,
            }

            setChannelState(nextState)
            setSelection((overrideChannel as ChannelSelection | null) ?? 'default')
            setUpdateStatus((currentUpdateStatus as UpdateStatus | null) ?? 'IDLE')
        } catch (error) {
            console.error(error)
            toast.custom('error', t('common.errorTitleShort'), t('header.updateChannel.loadError'))
        } finally {
            setLoading(false)
        }
    }, [t])

    useEffect(() => {
        if (!isOpen) {
            return
        }

        void loadState()
    }, [isOpen, loadState])

    useEffect(() => {
        if (!isOpen) {
            return
        }

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
    }, [isOpen])

    const options = useMemo(
        () => [
            {
                value: 'default',
                label: t('header.updateChannel.optionDefault', { channel: channelState.buildChannel }),
            },
            {
                value: 'beta',
                label: t('header.updateChannel.optionBeta'),
            },
            {
                value: 'dev',
                label: t('header.updateChannel.optionDev'),
            },
        ],
        [channelState.buildChannel, t],
    )

    const handleClose = useCallback(() => {
        closeModal(Modals.UPDATE_CHANNEL_OVERRIDE)
    }, [Modals.UPDATE_CHANNEL_OVERRIDE, closeModal])

    const handleSave = useCallback(async () => {
        setSaving(true)

        try {
            const overrideChannel = selection === 'default' || selection === channelState.buildChannel ? null : selection
            const nextState = (await desktopApi.updates.setChannelOverride({
                channel: overrideChannel,
                allowDevToBetaSwitch,
            })) as ChannelStateResponse

            setChannelState(nextState)
            setSelection(nextState.overrideChannel ?? 'default')

            desktopApi.updates.check({ manual: true })

            toast.custom('success', t('common.successTitleShort'), t('header.updateChannel.saved', { channel: nextState.effectiveChannel }))

            handleClose()
        } catch (error) {
            console.error(error)
            toast.custom('error', t('common.errorTitleShort'), t('header.updateChannel.saveError'))
        } finally {
            setSaving(false)
        }
    }, [allowDevToBetaSwitch, channelState.buildChannel, handleClose, selection, t])

    const overrideLabel = channelState.overrideChannel ?? t('header.updateChannel.noOverride')
    const hasOverride = channelState.overrideChannel !== null
    const nextChannel = selection === 'default' ? channelState.buildChannel : selection
    const isSwitchForbidden = !allowDevToBetaSwitch && channelState.effectiveChannel === 'dev' && nextChannel === 'beta'
    const isUnchangedSelection =
        (selection === 'default' && channelState.overrideChannel === null) || (selection !== 'default' && selection === channelState.overrideChannel)
    const summaryParts = [
        `${t('header.updateChannel.currentChannel')}: ${channelState.effectiveChannel}`,
        hasOverride
            ? `${t('header.updateChannel.overrideChannel')}: ${overrideLabel}`
            : `${t('header.updateChannel.buildChannel')}: ${channelState.buildChannel}`,
    ]

    return (
        <CustomModalPS
            className={styles.modal}
            title={
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>{t('header.updateChannel.title')}</div>
                    <button type="button" className={styles.closeButton} onClick={handleClose} aria-label={t('common.cancel')}>
                        <IoCloseSharp size={18} />
                    </button>
                </div>
            }
            isOpen={isOpen}
            onClose={handleClose}
            buttons={[
                {
                    text: t('common.cancel'),
                    onClick: handleClose,
                    variant: 'secondary',
                    disabled: saving,
                },
                {
                    text: saving ? t('header.updateChannel.saving') : t('header.updateChannel.apply'),
                    onClick: () => {
                        void handleSave()
                    },
                    variant: 'primary',
                    disabled: loading || saving || isSwitchBlocked || isSwitchForbidden || isUnchangedSelection,
                },
            ]}
        >
            <div className={styles.content}>
                <div className={styles.statusSummary}>{summaryParts.join(' · ')}</div>

                {isSwitchBlocked && <div className={styles.hint}>{t('header.updateChannel.busy')}</div>}
                {updateStatus === 'DOWNLOADED' && <div className={styles.hint}>{t('header.updateChannel.downloadedHint')}</div>}
                {isSwitchForbidden && <div className={styles.hint}>{t('header.updateChannel.switchDisabled')}</div>}

                <div className={styles.fieldWrap}>
                    <SelectInput
                        label={t('header.updateChannel.selectLabel')}
                        value={selection}
                        onChange={value => setSelection(value as ChannelSelection)}
                        options={options}
                        disabled={loading || saving || isSwitchBlocked}
                    />
                </div>

                {!isSwitchBlocked && selection !== 'default' && (
                    <div className={styles.hint}>{t('header.updateChannel.nextChannel', { channel: nextChannel })}</div>
                )}
            </div>
        </CustomModalPS>
    )
}

export default UpdateChannelOverrideModal
