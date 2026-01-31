import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as s from './SliderInput.module.scss'
import TooltipButton from '../../tooltip_button'
import { MdHelp } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

type Props = {
    label: string
    description?: string
    className?: string

    min: number
    max: number
    step?: number
    value: number
    onChange?: (v: number) => void

    disabled?: boolean
    unit?: string
    showNumber?: boolean
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
const snap = (n: number, step: number, min: number) => Math.round((n - min) / step) * step + min

const SliderInput: React.FC<Props> = ({
    label,
    description,
    className,
    min,
    max,
    step = 1,
    value,
    onChange,
    disabled = false,
    unit,
    showNumber = true,
}) => {
    const { t } = useTranslation()
    const trackRef = useRef<HTMLDivElement>(null)
    const [drag, setDrag] = useState(false)

    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState<string>('')

    const range = Math.max(0.00001, max - min)
    const v = clamp(value, min, max)
    const pct = ((v - min) / range) * 100

    const commit = (n: number) => onChange?.(clamp(snap(n, step, min), min, max))

    const format = (n: number) =>
        new Intl.NumberFormat('ru-RU', {
            maximumFractionDigits: 6,
        }).format(n) + (unit ? '' : '')

    useEffect(() => {
        if (!drag) return
        const onMove = (e: MouseEvent) => {
            if (!trackRef.current) return
            const rect = trackRef.current.getBoundingClientRect()
            const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            commit(min + x * range)
        }
        const onUp = () => setDrag(false)
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    }, [drag, min, range, step])

    const onTrackDown: React.MouseEventHandler<HTMLDivElement> = e => {
        if (disabled) return
        setDrag(true)
        if (!trackRef.current) return
        const rect = trackRef.current.getBoundingClientRect()
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        commit(min + x * range)
    }

    const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = e => {
        if (disabled) return
        const accel = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') {
            e.preventDefault()
            commit(v - step * accel)
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault()
            commit(v + step * accel)
        }
        if (e.key === 'Home') {
            e.preventDefault()
            commit(min)
        }
        if (e.key === 'End') {
            e.preventDefault()
            commit(max)
        }
    }

    const startEdit = () => {
        if (!showNumber || disabled) return
        setDraft(String(value))
        setEditing(true)
    }
    const stopEdit = (apply: boolean) => {
        if (apply) {
            const normalized = draft.replace(',', '.')
            const num = Number(normalized)
            if (Number.isFinite(num)) commit(num)
        }
        setEditing(false)
    }

    return (
        <div className={clsx(s.inputContainer, className)} style={disabled ? { opacity: 0.6, pointerEvents: 'none' } : {}}>
            <div className={s.label}>
                {label}
                {description && (
                    <TooltipButton className={s.tip} side="right" tooltipText={<div className={s.itemName}>{description}</div>}>
                        <MdHelp size={14} color="white" />
                    </TooltipButton>
                )}
            </div>

            <div className={s.row}>
                {showNumber && (
                    <div className={s.valBox}>
                        {!editing ? (
                            <button type="button" className={s.val} onClick={startEdit} title={t('common.clickToEdit')}>
                                {format(v)}
                                {unit && <span className={s.unitLabel}>{unit}</span>}
                            </button>
                        ) : (
                            <input
                                className={s.valInput}
                                autoFocus
                                value={draft}
                                onChange={e => setDraft(e.target.value)}
                                onBlur={() => stopEdit(true)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') stopEdit(true)
                                    if (e.key === 'Escape') stopEdit(false)
                                }}
                            />
                        )}
                    </div>
                )}

                <div
                    ref={trackRef}
                    className={s.track}
                    role="slider"
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuenow={v}
                    tabIndex={0}
                    onKeyDown={onKeyDown}
                    onMouseDown={onTrackDown}
                >
                    <div className={s.fill} style={{ width: `${pct}%` }} />
                    <div className={s.thumb} style={{ left: `${pct}%` }} />
                </div>
            </div>
        </div>
    )
}

export default SliderInput
