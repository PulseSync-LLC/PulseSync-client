import React, { useEffect, useMemo, useRef, useState } from 'react'
import CustomModalPS from '../CustomModalPS'
import * as st from './AddonUploadModal.module.scss'
import ButtonV2 from '../../buttonV2'
import { useTranslation } from 'react-i18next'

export type StepApi = {
    report: (progress: number, note?: string) => void
    signal: AbortSignal
}

export type UploadStep = {
    key: string
    label: string
    run: (api: StepApi) => Promise<void>
}

type StepStatus = 'idle' | 'running' | 'done' | 'error'

export interface AddonUploadModalProps {
    isOpen: boolean
    onClose: () => void
    addonName: string
    steps: UploadStep[]
    rulesHref?: string
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const icon = (s: StepStatus) => (s === 'done' ? '✔' : s === 'error' ? '✖' : '🕘')

const AddonUploadModal: React.FC<AddonUploadModalProps> = ({ isOpen, onClose, addonName, steps, rulesHref }) => {
    const { t } = useTranslation()
    const [statuses, setStatuses] = useState<Record<string, StepStatus>>({})
    const [progress, setProgress] = useState<Record<string, number>>({})
    const [notes, setNotes] = useState<Record<string, string | undefined>>({})
    const [running, setRunning] = useState(false)
    const [errText, setErrText] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        const s: Record<string, StepStatus> = {}
        const p: Record<string, number> = {}
        steps.forEach(x => {
            s[x.key] = 'idle'
            p[x.key] = 0
        })
        setStatuses(s)
        setProgress(p)
        setNotes({})
        setErrText(null)
    }, [steps, isOpen])

    const allDone = useMemo(() => steps.length > 0 && steps.every(s => statuses[s.key] === 'done'), [steps, statuses])
    const hasError = useMemo(() => Object.values(statuses).some(s => s === 'error'), [statuses])

    const start = async () => {
        if (running) return
        setErrText(null)
        setRunning(true)
        abortRef.current = new AbortController()

        try {
            for (const step of steps) {
                if (abortRef.current.signal.aborted) throw new Error(t('common.operationCancelled'))
                setStatuses(prev => ({ ...prev, [step.key]: 'running' }))
                setProgress(prev => ({ ...prev, [step.key]: 0 }))

                const report = (pct: number, note?: string) => {
                    setProgress(prev => ({ ...prev, [step.key]: clamp(pct) }))
                    if (note !== undefined) setNotes(prev => ({ ...prev, [step.key]: note }))
                }

                try {
                    await step.run({ report, signal: abortRef.current.signal })
                    setStatuses(prev => ({ ...prev, [step.key]: 'done' }))
                    setProgress(prev => ({ ...prev, [step.key]: 100 }))
                } catch (e: any) {
                    setStatuses(prev => ({ ...prev, [step.key]: 'error' }))
                    setErrText(e?.message || t('common.errorTitle'))
                    break
                }
            }
        } finally {
            setRunning(false)
        }
    }

    const cancel = () => {
        abortRef.current?.abort()
        setRunning(false)
    }

    const reset = () => {
        const s: Record<string, StepStatus> = {}
        const p: Record<string, number> = {}
        steps.forEach(x => {
            s[x.key] = 'idle'
            p[x.key] = 0
        })
        setStatuses(s)
        setProgress(p)
        setNotes({})
        setErrText(null)
    }

    const buttons = useMemo(() => {
        if (running) return [{ text: t('common.cancel'), onClick: cancel, variant: 'danger' as const }]
        if (hasError) {
            return [
                { text: t('common.submit'), onClick: start, variant: 'primary' as const },
                { text: t('common.cancel'), onClick: onClose, variant: 'secondary' as const },
            ]
        }
        if (allDone) return [{ text: t('common.doneTitle'), onClick: onClose, variant: 'primary' as const }]
        return [
            { text: t('common.submit'), onClick: start, variant: 'primary' as const },
            { text: t('common.cancel'), onClick: onClose, variant: 'secondary' as const },
        ]
    }, [running, hasError, allDone, onClose, t])

    return (
        <CustomModalPS
            isOpen={isOpen}
            onClose={() => {
                if (!running) onClose()
            }}
            title={t('addons.uploadTitle', { name: addonName })}
            text={undefined}
            subText={undefined}
            buttons={buttons}
        >
            {rulesHref && !running && !hasError && !allDone && (
                <div className={st.rulesLine}>
                    <span className={st.rulesFlag}>⚑</span>
                    <span>
                        {t('addons.uploadRules')}{' '}
                        <a href={rulesHref} target="_blank" rel="noreferrer" className={st.rulesLink}>
                            {t('common.linkLabel')}
                        </a>
                    </span>
                </div>
            )}

            <ul className={st.list} aria-live="polite">
                {steps.map(step => {
                    const state = statuses[step.key] ?? 'idle'
                    const pct = progress[step.key] ?? 0
                    const note = notes[step.key]

                    return (
                        <li key={step.key} className={`${st.row} ${st[`st_${state}`]}`}>
                            <span className={st.rowIcon} aria-hidden>
                                {icon(state)}
                            </span>
                            <div className={st.rowTextWrap}>
                                <div className={st.rowLabel}>{step.label}</div>

                                {state === 'running' && (
                                    <div className={st.progress}>
                                        <div className={st.progressFill} style={{ width: `${pct}%` }} />
                                    </div>
                                )}

                                {note && <div className={st.note}>{note}</div>}
                            </div>
                        </li>
                    )
                })}
            </ul>

            {errText && (
                <div className={st.errorInline}>
                    {errText}
                    <ButtonV2 className={st.resetBtn} onClick={reset}>
                        {t('common.reset')}
                    </ButtonV2>
                </div>
            )}
        </CustomModalPS>
    )
}

export default AddonUploadModal
