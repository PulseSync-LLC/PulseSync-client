import React, { useCallback, useEffect, useMemo, useState } from 'react'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import Loader from '@shared/ui/PSUI/Loader'
import toast from '@shared/ui/toast'
import { fetchDetailedExperiments } from '@entities/experiment/api/experiments'
import { useExperiments } from '@app/providers/experiments'
import type { DesktopDetailedExperiment, DesktopExperiment } from '@app/providers/experiments/types'
import { useModalContext } from '@app/providers/modal'
import { useTranslation } from 'react-i18next'
import { IoCloseSharp } from 'react-icons/io5'
import { MdContentCopy } from 'react-icons/md'
import * as styles from '@widgets/modalContainer/modals/ExperimentOverridesDevModal.module.scss'

type OverrideDraft = {
    group: string
    metaText: string
}

const EMPTY_DRAFT: OverrideDraft = {
    group: '',
    metaText: '',
}

function stringifyMeta(value: DesktopExperiment['meta']) {
    if (!value || Object.keys(value).length === 0) {
        return ''
    }

    return JSON.stringify(value, null, 2)
}

const ExperimentOverridesDevModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, isModalOpen, closeModal } = useModalContext()
    const { experiments, loading, localOverrides, setLocalOverride, clearLocalOverride } = useExperiments()
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT)
    const [detailedExperiments, setDetailedExperiments] = useState<DesktopDetailedExperiment[]>([])
    const [detailedLoading, setDetailedLoading] = useState(false)
    const [detailedError, setDetailedError] = useState<string | null>(null)

    const isOpen = isModalOpen(Modals.EXPERIMENT_OVERRIDES_DEV)

    const sortedExperiments = useMemo(() => [...detailedExperiments].sort((a, b) => a.key.localeCompare(b.key)), [detailedExperiments])

    const selectedExperiment = useMemo(() => {
        if (!selectedKey) {
            return undefined
        }

        return sortedExperiments.find(experiment => experiment.key === selectedKey)
    }, [selectedKey, sortedExperiments])

    const selectedActiveExperiment = useMemo(() => {
        if (!selectedKey) {
            return undefined
        }

        return experiments.find(experiment => experiment.key === selectedKey)
    }, [experiments, selectedKey])

    const selectedOverride = selectedKey ? localOverrides[selectedKey] : undefined

    useEffect(() => {
        if (!isOpen) {
            return
        }

        let active = true

        setDetailedLoading(true)
        setDetailedError(null)

        void fetchDetailedExperiments()
            .then(nextExperiments => {
                if (!active) {
                    return
                }

                setDetailedExperiments(nextExperiments)
            })
            .catch(error => {
                if (!active) {
                    return
                }

                setDetailedExperiments([])
                setDetailedError(error instanceof Error ? error.message : null)
            })
            .finally(() => {
                if (active) {
                    setDetailedLoading(false)
                }
            })

        return () => {
            active = false
        }
    }, [isOpen])

    useEffect(() => {
        if (!sortedExperiments.length) {
            setSelectedKey(null)
            return
        }

        const hasCurrentSelection = selectedKey ? sortedExperiments.some(experiment => experiment.key === selectedKey) : false
        if (hasCurrentSelection) {
            return
        }

        const firstOverrideKey = sortedExperiments.find(experiment => localOverrides[experiment.key])?.key
        setSelectedKey(firstOverrideKey ?? sortedExperiments[0].key)
    }, [localOverrides, selectedKey, sortedExperiments])

    useEffect(() => {
        if (!selectedExperiment) {
            setDraft(EMPTY_DRAFT)
            return
        }

        const matchedGroup =
            selectedExperiment.groups.find(group => group.group === selectedOverride?.group) ??
            selectedExperiment.groups.find(group => group.group === selectedActiveExperiment?.group) ??
            selectedExperiment.groups[0]

        const nextGroup = selectedOverride?.group ?? selectedActiveExperiment?.group ?? matchedGroup?.group ?? ''
        const nextMeta = selectedOverride?.meta ?? selectedActiveExperiment?.meta ?? matchedGroup?.meta ?? {}

        setDraft({
            group: nextGroup,
            metaText: stringifyMeta(nextMeta),
        })
    }, [selectedActiveExperiment, selectedExperiment, selectedOverride])

    const handleClose = useCallback(() => {
        closeModal(Modals.EXPERIMENT_OVERRIDES_DEV)
    }, [Modals, closeModal])

    const handleApply = useCallback(() => {
        if (!selectedExperiment) {
            return
        }

        const normalizedGroup = draft.group.trim()
        if (!normalizedGroup) {
            toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.groupRequired'))
            return
        }

        let parsedMeta: Record<string, unknown> = {}
        if (draft.metaText.trim()) {
            try {
                const parsed = JSON.parse(draft.metaText)
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.metaObjectError'))
                    return
                }

                parsedMeta = parsed as Record<string, unknown>
            } catch {
                toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.invalidJson'))
                return
            }
        }

        setLocalOverride({
            key: selectedExperiment.key,
            group: normalizedGroup,
            meta: parsedMeta,
        })

        toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.applied'))
    }, [draft, selectedExperiment, setLocalOverride, t])

    const handleClear = useCallback(() => {
        if (!selectedKey || !localOverrides[selectedKey]) {
            return
        }

        clearLocalOverride(selectedKey)
        toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.cleared'))
    }, [clearLocalOverride, localOverrides, selectedKey, t])

    const handleCopyExperimentKey = useCallback(async () => {
        if (!selectedExperiment?.key) {
            return
        }

        try {
            await navigator.clipboard.writeText(selectedExperiment.key)
            toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.copyNameSuccess'))
        } catch {
            toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.copyNameError'))
        }
    }, [selectedExperiment?.key, t])

    const handleApplyGroupPreset = useCallback((group: DesktopDetailedExperiment['groups'][number]) => {
        setDraft({
            group: group.group,
            metaText: stringifyMeta(group.meta),
        })
    }, [])

    return (
        <CustomModalPS
            className={styles.modal}
            title={
                <div className={styles.modalHeader}>
                    <div className={styles.modalTitle}>{t('header.devOverrides.title')}</div>
                    <button type="button" className={styles.closeButton} onClick={handleClose} aria-label={t('common.cancel')}>
                        <IoCloseSharp size={18} />
                    </button>
                </div>
            }
            isOpen={isOpen}
            onClose={handleClose}
            allowNoChoice={false}
            buttons={
                selectedExperiment
                    ? [
                          {
                              text: t('header.devOverrides.clear'),
                              onClick: handleClear,
                              variant: 'secondary',
                              disabled: !selectedOverride,
                          },
                          {
                              text: t('header.devOverrides.apply'),
                              onClick: handleApply,
                              variant: 'primary',
                          },
                      ]
                    : []
            }
        >
            {loading || detailedLoading ? (
                <div className={styles.empty}>
                    <Loader variant="panel" />
                </div>
            ) : detailedError ? (
                <div className={styles.empty}>{detailedError || t('common.fetchFailed')}</div>
            ) : sortedExperiments.length === 0 ? (
                <div className={styles.empty}>{t('header.devOverrides.empty')}</div>
            ) : (
                <div className={styles.modalBody}>
                    <div className={styles.list}>
                        {sortedExperiments.map(experiment => {
                            const isSelected = experiment.key === selectedKey
                            const hasOverride = Boolean(localOverrides[experiment.key])
                            const activeExperiment = hasOverride ? localOverrides[experiment.key] : experiments.find(active => active.key === experiment.key)

                            return (
                                <button
                                    key={experiment.key}
                                    type="button"
                                    className={`${styles.item} ${isSelected ? styles.itemActive : ''}`}
                                    onClick={() => setSelectedKey(experiment.key)}
                                >
                                    <div className={styles.itemTop}>
                                        <span className={styles.itemKey}>{experiment.key}</span>
                                        {hasOverride && <span className={styles.itemBadge}>{t('header.devOverrides.overrideBadge')}</span>}
                                    </div>
                                    <div className={styles.metaRow}>
                                        <span className={styles.metaChip}>{activeExperiment?.group || t('header.devOverrides.noGroup')}</span>
                                        <span className={styles.metaChip}>{t('header.devOverrides.groupsCount', { count: experiment.groups.length })}</span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    <div className={styles.form}>
                        {selectedExperiment ? (
                            <>
                                <div className={styles.formTop}>
                                    <div className={styles.formHeading}>
                                        <div className={styles.formTitleRow}>
                                            <div className={styles.formTitle}>{selectedExperiment.key}</div>
                                            <button
                                                type="button"
                                                className={styles.copyButton}
                                                onClick={handleCopyExperimentKey}
                                                title={t('header.devOverrides.copyName')}
                                                aria-label={t('header.devOverrides.copyName')}
                                            >
                                                <MdContentCopy size={16} />
                                                <span>{t('header.devOverrides.copyName')}</span>
                                            </button>
                                        </div>
                                        {selectedExperiment.description && <p className={styles.formDescription}>{selectedExperiment.description}</p>}
                                    </div>
                                    <div className={styles.metaRow}>
                                        <span className={styles.metaChip}>{t('header.devOverrides.groupsCount', { count: selectedExperiment.groups.length })}</span>
                                        {selectedOverride && <span className={styles.metaChipActive}>{t('header.devOverrides.overrideActive')}</span>}
                                    </div>
                                </div>

                                <div className={styles.editorSection}>
                                    <span className={styles.fieldLabel}>{t('header.devOverrides.availableGroups')}</span>
                                    <div className={styles.groupsGrid}>
                                        {selectedExperiment.groups.map(group => (
                                            <button
                                                key={group.group}
                                                type="button"
                                                className={`${styles.groupButton} ${draft.group === group.group ? styles.groupButtonActive : ''}`}
                                                onClick={() => handleApplyGroupPreset(group)}
                                            >
                                                <div className={styles.itemTop}>
                                                    <span className={styles.groupButtonName}>{group.group}</span>
                                                    <span className={styles.metaChip}>{t('header.devOverrides.groupRollout', { percentage: group.rollout })}</span>
                                                </div>
                                                <div className={styles.groupDescription}>
                                                    {group.description || t('header.devOverrides.groupDescriptionEmpty')}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className={styles.editorSection}>
                                    <label className={styles.field}>
                                        <span className={styles.fieldLabel}>{t('header.devOverrides.group')}</span>
                                        <input
                                            className={styles.fieldInput}
                                            value={draft.group}
                                            onChange={event => setDraft(prev => ({ ...prev, group: event.target.value }))}
                                            placeholder={t('header.devOverrides.groupPlaceholder')}
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span className={styles.fieldLabel}>{t('header.devOverrides.metaLabel')}</span>
                                        <textarea
                                            className={styles.textarea}
                                            value={draft.metaText}
                                            onChange={event => setDraft(prev => ({ ...prev, metaText: event.target.value }))}
                                            placeholder='{"variant":"new"}'
                                            rows={12}
                                        />
                                    </label>
                                </div>
                            </>
                        ) : (
                            <div className={styles.empty}>{t('header.devOverrides.selectExperiment')}</div>
                        )}
                    </div>
                </div>
            )}
        </CustomModalPS>
    )
}

export default ExperimentOverridesDevModal
