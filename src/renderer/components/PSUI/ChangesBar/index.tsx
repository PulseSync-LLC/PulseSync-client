import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as css from './ChangesBar.module.scss'
import { useTranslation } from 'react-i18next'

type Props = {
    open: boolean
    text?: string
    onReset?: () => void
    onSave?: () => void | Promise<void>
    saving?: boolean
    durationMs?: number
    disabledSave?: boolean
}

const ChangesBar: React.FC<Props> = ({ open, text, onReset, onSave, saving: savingProp, durationMs = 220, disabledSave = false }) => {
    const { t } = useTranslation()
    const displayText = text ?? t('changes.unsavedWarning')
    const [mounted, setMounted] = useState(open)
    const [phase, setPhase] = useState<'enter' | 'show' | 'hide'>('hide')
    const [savingInt, setSavingInt] = useState(false)
    const tRef = useRef<number | null>(null)

    const saving = !!(savingProp ?? savingInt)

    useEffect(() => {
        if (open) {
            setMounted(true)
            requestAnimationFrame(() => setPhase('show'))
        } else if (mounted) {
            setPhase('hide')
            if (tRef.current) cancelAnimationFrame(tRef.current)
            const id = window.setTimeout(() => setMounted(false), durationMs)
            tRef.current = id as unknown as number
            return () => window.clearTimeout(id)
        }
    }, [open])

    useEffect(
        () => () => {
            if (tRef.current) window.clearTimeout(tRef.current)
        },
        [],
    )

    const doSave = async () => {
        if (!onSave || saving || disabledSave) return
        try {
            setSavingInt(true)
            await onSave()
            if (open) setPhase('hide')
        } finally {
            setSavingInt(false)
        }
    }

    if (!mounted) return null

    return (
        <div
            className={clsx(css.changesBar, phase === 'show' && css.show, phase === 'hide' && css.hide, saving && css.saving)}
            role="status"
            aria-live="polite"
        >
            <div className={css.changesText}>{displayText}</div>

            {onReset && (
                <button className={css.linkBtn} type="button" onClick={onReset} disabled={saving}>
                    {t('common.reset')}
                </button>
            )}

            {onSave && (
                <button className={css.saveBtn} type="button" onClick={doSave} disabled={saving || disabledSave}>
                    {saving ? t('changes.saving') : t('changes.saveChanges')}
                </button>
            )}
        </div>
    )
}

export default ChangesBar
