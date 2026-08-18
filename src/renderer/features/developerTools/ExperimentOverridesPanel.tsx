import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'
import { MdContentCopy, MdSearch } from 'react-icons/md'

import { useExperiments } from '@app/providers/experiments'
import { fetchDetailedExperiments } from '@entities/experiment/api/experiments'
import { desktopApi } from '@shared/desktop/desktopApi'
import SelectInput from '@shared/ui/PSUI/SelectInput'
import toast from '@shared/ui/toast'

import * as styles from '@features/developerTools/ExperimentOverridesPanel.module.scss'

import type { DesktopDetailedExperiment, DesktopExperiment } from '@app/providers/experiments/types'

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

const ExperimentOverridesPanel: React.FC = () => {
    const { t } = useTranslation()
    const { experiments, loading, localOverrides, setLocalOverride, clearLocalOverride } = useExperiments()
    const [expandedKey, setExpandedKey] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const [draft, setDraft] = useState<OverrideDraft>(EMPTY_DRAFT)
    const [detailedExperiments, setDetailedExperiments] = useState<DesktopDetailedExperiment[]>([])
    const [detailedLoading, setDetailedLoading] = useState(false)
    const [detailedError, setDetailedError] = useState<string | null>(null)

    const sortedExperiments = useMemo(() => [...detailedExperiments].sort((a, b) => a.key.localeCompare(b.key)), [detailedExperiments])

    const filteredExperiments = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase()
        if (!normalizedQuery) {
            return sortedExperiments
        }

        return sortedExperiments.filter(
            experiment =>
                experiment.key.toLocaleLowerCase().includes(normalizedQuery) || experiment.description.toLocaleLowerCase().includes(normalizedQuery),
        )
    }, [query, sortedExperiments])

    const expandedExperiment = useMemo(() => sortedExperiments.find(experiment => experiment.key === expandedKey), [expandedKey, sortedExperiments])
    const expandedServerExperiment = useMemo(() => experiments.find(experiment => experiment.key === expandedKey), [expandedKey, experiments])
    const expandedOverride = expandedKey ? localOverrides[expandedKey] : undefined
    const activeOverrideCount = Object.keys(localOverrides).length

    useEffect(() => {
        let active = true

        setDetailedLoading(true)
        setDetailedError(null)

        void fetchDetailedExperiments()
            .then(nextExperiments => {
                if (active) {
                    setDetailedExperiments(nextExperiments)
                }
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
    }, [])

    useEffect(() => {
        if (!expandedExperiment) {
            setDraft(EMPTY_DRAFT)
            return
        }

        const matchedGroup =
            expandedExperiment.groups.find(group => group.group === expandedOverride?.group) ??
            expandedExperiment.groups.find(group => group.group === expandedServerExperiment?.group) ??
            expandedExperiment.groups[0]

        setDraft({
            group: expandedOverride?.group ?? expandedServerExperiment?.group ?? matchedGroup?.group ?? '',
            metaText: stringifyMeta(expandedOverride?.meta ?? expandedServerExperiment?.meta ?? matchedGroup?.meta ?? {}),
        })
    }, [expandedExperiment, expandedOverride, expandedServerExperiment])

    const handleApplyAdvanced = useCallback(() => {
        if (!expandedExperiment) {
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
            key: expandedExperiment.key,
            group: normalizedGroup,
            meta: parsedMeta,
        })
        toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.applied'))
    }, [draft, expandedExperiment, setLocalOverride, t])

    const handleClearExpanded = useCallback(() => {
        if (!expandedKey || !localOverrides[expandedKey]) {
            return
        }

        clearLocalOverride(expandedKey)
        toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.cleared'))
    }, [clearLocalOverride, expandedKey, localOverrides, t])

    const handleGroupOverride = useCallback(
        (experiment: DesktopDetailedExperiment, groupName: string) => {
            if (!groupName) {
                if (localOverrides[experiment.key]) {
                    clearLocalOverride(experiment.key)
                    toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.cleared'))
                }
                return
            }

            const group = experiment.groups.find(candidate => candidate.group === groupName)
            setLocalOverride({
                key: experiment.key,
                group: groupName,
                meta: group?.meta ?? {},
            })
            toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.applied'))
        },
        [clearLocalOverride, localOverrides, setLocalOverride, t],
    )

    const handleClearAll = useCallback(() => {
        if (!activeOverrideCount) {
            return
        }

        Object.keys(localOverrides).forEach(key => clearLocalOverride(key))
        toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.clearedAll'))
    }, [activeOverrideCount, clearLocalOverride, localOverrides, t])

    const handleCopyExperimentKey = useCallback(async () => {
        if (!expandedExperiment?.key) {
            return
        }

        try {
            await desktopApi.system.writeClipboardText(expandedExperiment.key)
            toast.custom('success', t('common.successTitleShort'), t('header.devOverrides.copyNameSuccess'))
        } catch {
            toast.custom('error', t('common.errorTitleShort'), t('header.devOverrides.copyNameError'))
        }
    }, [expandedExperiment?.key, t])

    const handleApplyGroupPreset = useCallback((group: DesktopDetailedExperiment['groups'][number]) => {
        setDraft({
            group: group.group,
            metaText: stringifyMeta(group.meta),
        })
    }, [])

    return (
        <section className={styles.panel}>
            <div className={styles.panelHeader}>
                <div>
                    <h2 className={styles.panelTitle}>{t('header.devOverrides.title')}</h2>
                    <p className={styles.panelDescription}>{t('header.devOverrides.description')}</p>
                </div>
                <button type="button" className={styles.clearAllButton} onClick={handleClearAll} disabled={!activeOverrideCount}>
                    {t('header.devOverrides.clearAll', { count: activeOverrideCount })}
                </button>
            </div>

            <div className={styles.warningCard}>
                <strong>{t('header.devOverrides.warningTitle')}</strong>
                <p>{t('header.devOverrides.warningBody')}</p>
                <p>{t('header.devOverrides.warningHint')}</p>
            </div>

            <label className={styles.searchField}>
                <MdSearch size={18} aria-hidden="true" />
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t('header.devOverrides.searchPlaceholder')}
                    aria-label={t('header.devOverrides.searchPlaceholder')}
                />
            </label>

            {loading || detailedLoading ? (
                <div className={styles.shimmerList} aria-hidden="true">
                    {Array.from({ length: 5 }, (_, index) => (
                        <div key={index} className={styles.shimmerExperiment}>
                            <span className={styles.shimmerTitle} />
                            <span className={styles.shimmerDescription} />
                            <span className={styles.shimmerSelect} />
                        </div>
                    ))}
                </div>
            ) : detailedError ? (
                <div className={styles.empty}>{detailedError || t('common.fetchFailed')}</div>
            ) : sortedExperiments.length === 0 ? (
                <div className={styles.empty}>{t('header.devOverrides.empty')}</div>
            ) : filteredExperiments.length === 0 ? (
                <div className={styles.empty}>{t('header.devOverrides.searchEmpty')}</div>
            ) : (
                <div className={styles.experimentList}>
                    {filteredExperiments.map(experiment => {
                        const serverExperiment = experiments.find(active => active.key === experiment.key)
                        const override = localOverrides[experiment.key]
                        const effectiveExperiment = override ?? serverExperiment
                        const expanded = expandedKey === experiment.key

                        return (
                            <article key={experiment.key} className={styles.experimentItem}>
                                <div className={styles.experimentHeader}>
                                    <div className={styles.experimentHeading}>
                                        <div className={styles.experimentTitle}>{experiment.key}</div>
                                        {experiment.description && <div className={styles.experimentDescription}>{experiment.description}</div>}
                                    </div>
                                    <span className={styles.experimentScope}>{t('header.devOverrides.userScope')}</span>
                                </div>

                                <div className={styles.variantSection}>
                                    <SelectInput
                                        label={t('header.devOverrides.variantOverride')}
                                        value={override?.group ?? ''}
                                        onChange={value => handleGroupOverride(experiment, String(value))}
                                        options={[
                                            {
                                                value: '',
                                                label: t('header.devOverrides.serverDefault', {
                                                    group: serverExperiment?.group || t('header.devOverrides.notSet'),
                                                }),
                                            },
                                            ...experiment.groups.map(group => ({
                                                value: group.group,
                                                label: group.group,
                                            })),
                                        ]}
                                    />
                                    <div className={styles.assignmentValue}>
                                        {t('header.devOverrides.currentlyAssigned', {
                                            group: serverExperiment?.group || t('header.devOverrides.notSet'),
                                        })}
                                    </div>
                                    <div className={styles.effectiveValue}>
                                        {t('header.devOverrides.effectiveValue')}: {effectiveExperiment?.group || t('header.devOverrides.notSet')}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className={styles.detailsToggle}
                                    aria-expanded={expanded}
                                    onClick={() => setExpandedKey(current => (current === experiment.key ? null : experiment.key))}
                                >
                                    {t(expanded ? 'header.devOverrides.hideDetails' : 'header.devOverrides.moreDetails')}
                                </button>

                                {expanded && expandedExperiment && (
                                    <div className={styles.details}>
                                        <div className={styles.detailsHeader}>
                                            <div className={styles.stateRow}>
                                                <span>
                                                    {t('header.devOverrides.serverValue')}:{' '}
                                                    {expandedServerExperiment?.group || t('header.devOverrides.notSet')}
                                                </span>
                                                <span>
                                                    {t('header.devOverrides.overrideValue')}:{' '}
                                                    {expandedOverride?.group || t('header.devOverrides.notSet')}
                                                </span>
                                            </div>
                                            <button type="button" className={styles.copyButton} onClick={handleCopyExperimentKey}>
                                                <MdContentCopy size={15} aria-hidden="true" />
                                                {t('header.devOverrides.copyName')}
                                            </button>
                                        </div>

                                        <div className={styles.groupsGrid}>
                                            {expandedExperiment.groups.map(group => (
                                                <button
                                                    key={group.group}
                                                    type="button"
                                                    className={`${styles.groupButton} ${draft.group === group.group ? styles.groupButtonActive : ''}`}
                                                    onClick={() => handleApplyGroupPreset(group)}
                                                >
                                                    <span>{group.group}</span>
                                                    <small>{group.description || t('header.devOverrides.groupDescriptionEmpty')}</small>
                                                    <em>{t('header.devOverrides.groupRollout', { percentage: group.rollout })}</em>
                                                </button>
                                            ))}
                                        </div>

                                        <div className={styles.advancedEditor}>
                                            <label className={styles.field}>
                                                <span>{t('header.devOverrides.group')}</span>
                                                <input
                                                    value={draft.group}
                                                    onChange={event => setDraft(previous => ({ ...previous, group: event.target.value }))}
                                                    placeholder={t('header.devOverrides.groupPlaceholder')}
                                                />
                                            </label>
                                            <label className={styles.field}>
                                                <span>{t('header.devOverrides.metaLabel')}</span>
                                                <textarea
                                                    value={draft.metaText}
                                                    onChange={event => setDraft(previous => ({ ...previous, metaText: event.target.value }))}
                                                    placeholder='{"variant":"new"}'
                                                    rows={7}
                                                />
                                            </label>
                                        </div>

                                        <div className={styles.detailsActions}>
                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                onClick={handleClearExpanded}
                                                disabled={!expandedOverride}
                                            >
                                                {t('header.devOverrides.clear')}
                                            </button>
                                            <button type="button" className={styles.primaryButton} onClick={handleApplyAdvanced}>
                                                {t('header.devOverrides.apply')}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </article>
                        )
                    })}
                </div>
            )}
        </section>
    )
}

export default ExperimentOverridesPanel
