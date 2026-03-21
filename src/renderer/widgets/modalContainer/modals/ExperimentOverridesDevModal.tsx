import React, { useCallback, useEffect, useMemo, useState } from 'react'
import CustomModalPS from '@shared/ui/PSUI/CustomModalPS'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import Loader from '@shared/ui/PSUI/Loader'
import toast from '@shared/ui/toast'
import { useExperiments } from '@app/providers/experiments'
import type { DesktopExperiment } from '@app/providers/experiments/types'
import { useModalContext } from '@app/providers/modal'
import { useTranslation } from 'react-i18next'
import { IoCloseSharp } from 'react-icons/io5'
import * as styles from '@widgets/modalContainer/modals/ExperimentOverridesDevModal.module.scss'

type EnabledMode = 'inherit' | 'true' | 'false'

type OverrideDraft = {
    group: string
    enabledMode: EnabledMode
    valueText: string
}

const EMPTY_DRAFT: OverrideDraft = {
    group: '',
    enabledMode: 'inherit',
    valueText: '',
}

function stringifyValue(value: DesktopExperiment['value']) {
    if (!value || Object.keys(value).length === 0) {
        return ''
    }

    return JSON.stringify(value, null, 2)
}

function getEnabledMode(experiment?: DesktopExperiment | null): EnabledMode {
    if (typeof experiment?.enabled === 'boolean') {
        return experiment.enabled ? 'true' : 'false'
    }

    return 'inherit'
}

function getExperimentStateLabel(experiment: DesktopExperiment, t: (key: string, options?: any) => string) {
    if (typeof experiment.enabled === 'boolean') {
        return experiment.enabled ? t('header.devOverrides.enabled.on') : t('header.devOverrides.enabled.off')
    }

    return t('header.devOverrides.enabled.inherit')
}

const ExperimentOverridesDevModal: React.FC = () => {
    const { t } = useTranslation()
    const { Modals, isModalOpen, closeModal } = useModalContext()
    const { experiments, loading, localOverrides, setLocalOverride, clearLocalOverride } = useExperiments()
    const [selectedKey, setSelectedKey] = useState<string | null>(null)
    const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT)

    const isOpen = isModalOpen(Modals.EXPERIMENT_OVERRIDES_DEV)

    const enabledOptions = useMemo(
        () => [
            { value: 'inherit', label: t('header.devOverrides.enabled.inherit') },
            { value: 'true', label: t('header.devOverrides.enabled.on') },
            { value: 'false', label: t('header.devOverrides.enabled.off') },
        ],
        [t],
    )

    const sortedExperiments = useMemo(() => [...experiments].sort((a, b) => a.key.localeCompare(b.key)), [experiments])

    const selectedExperiment = useMemo(() => {
        if (!selectedKey) {
            return undefined
        }

        return sortedExperiments.find(experiment => experiment.key === selectedKey)
    }, [selectedKey, sortedExperiments])

    const selectedOverride = selectedKey ? localOverrides[selectedKey] : undefined

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
        const source = selectedOverride ?? selectedExperiment
        if (!source) {
            setDraft(EMPTY_DRAFT)
            return
        }

        setDraft({
            group: source.group ?? '',
            enabledMode: getEnabledMode(source),
            valueText: stringifyValue(source.value),
        })
    }, [selectedExperiment, selectedOverride])

    const handleClose = useCallback(() => {
        closeModal(Modals.EXPERIMENT_OVERRIDES_DEV)
    }, [Modals, closeModal])

    const handleApply = useCallback(() => {
        if (!selectedExperiment) {
            return
        }

        let parsedValue: Record<string, unknown> | null = null
        if (draft.valueText.trim()) {
            try {
                const parsed = JSON.parse(draft.valueText)
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.valueObjectError'))
                    return
                }

                parsedValue = parsed as Record<string, unknown>
            } catch {
                toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.invalidJson'))
                return
            }
        }

        setLocalOverride({
            ...selectedExperiment,
            group: draft.group.trim() || null,
            enabled: draft.enabledMode === 'inherit' ? null : draft.enabledMode === 'true',
            value: parsedValue,
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
            {loading ? (
                <div className={styles.empty}>
                    <Loader variant="panel" />
                </div>
            ) : sortedExperiments.length === 0 ? (
                <div className={styles.empty}>{t('header.devOverrides.empty')}</div>
            ) : (
                <div className={styles.modalBody}>
                    <div className={styles.list}>
                        {sortedExperiments.map(experiment => {
                            const isSelected = experiment.key === selectedKey
                            const hasOverride = Boolean(localOverrides[experiment.key])

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
                                        <span className={styles.metaChip}>{experiment.group || t('header.devOverrides.noGroup')}</span>
                                        <span className={styles.metaChip}>{getExperimentStateLabel(experiment, t)}</span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>

                    <div className={styles.form}>
                        {selectedExperiment ? (
                            <>
                                <div className={styles.formTop}>
                                    <div>
                                        <div className={styles.formTitle}>{selectedExperiment.key}</div>
                                        {selectedExperiment.description && <p className={styles.formDescription}>{selectedExperiment.description}</p>}
                                    </div>
                                    <div className={styles.metaRow}>
                                        <span className={styles.metaChip}>
                                            {t('header.devOverrides.rollout', { percentage: selectedExperiment.rollout?.percentage ?? 0 })}
                                        </span>
                                        {selectedOverride && <span className={styles.metaChipActive}>{t('header.devOverrides.overrideActive')}</span>}
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

                                    <SelectInput
                                        className={styles.selectField}
                                        label={t('header.devOverrides.enabledLabel')}
                                        value={draft.enabledMode}
                                        onChange={value => setDraft(prev => ({ ...prev, enabledMode: value as EnabledMode }))}
                                        options={enabledOptions}
                                    />
                                </div>

                                <div className={styles.editorSection}>
                                    <label className={styles.field}>
                                        <span className={styles.fieldLabel}>{t('header.devOverrides.valueLabel')}</span>
                                        <textarea
                                            className={styles.textarea}
                                            value={draft.valueText}
                                            onChange={event => setDraft(prev => ({ ...prev, valueText: event.target.value }))}
                                            placeholder='{"enabled": true}'
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
