import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import * as s from './SelectInput.module.scss'
import TooltipButton from '../../tooltip_button'
import { MdHelp, MdKeyboardArrowDown, MdCheck } from 'react-icons/md'

type Option = { value: string | number; label: string }

type Props = {
    label: string
    description?: string
    className?: string
    value: string | number | null | undefined
    options: Option[]
    onChange?: (v: string | number) => void
    disabled?: boolean
    placeholder?: string
}

const SelectInput: React.FC<Props> = ({ label, description, className, value, options, onChange, disabled = false, placeholder = 'Выберите…' }) => {
    const [open, setOpen] = useState(false)
    const [alignRight, setAlignRight] = useState(false)
    const [panelW, setPanelW] = useState<number | undefined>(undefined)
    const [hover, setHover] = useState<number>(-1)

    const wrapRef = useRef<HTMLDivElement>(null)
    const btnRef = useRef<HTMLButtonElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    const idxByValue = useMemo(() => options.findIndex(o => String(o.value) === String(value)), [options, value])
    const selected = idxByValue >= 0 ? options[idxByValue] : null

    useEffect(() => {
        const h = (e: MouseEvent) => {
            if (!wrapRef.current) return
            if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', h)
        return () => document.removeEventListener('mousedown', h)
    }, [])

    useEffect(() => {
        if (!open) return
        const rect = btnRef.current?.getBoundingClientRect()
        if (rect) setPanelW(rect.width)
        const panelRect = listRef.current?.getBoundingClientRect()
        if (panelRect) {
            const oobRight = panelRect.right > window.innerWidth - 8
            const oobLeft = panelRect.left < 8
            setAlignRight(oobRight && !oobLeft)
        }
    }, [open])

    const commit = (i: number) => {
        const opt = options[i]
        if (!opt) return
        onChange?.(opt.value)
        setOpen(false)
    }

    const toggle = () => {
        if (disabled) return
        setOpen(v => {
            const next = !v
            if (next) setHover(idxByValue >= 0 ? idxByValue : 0)
            return next
        })
    }

    const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = e => {
        if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            toggle()
            return
        }
        if (!open) return
        if (e.key === 'Escape') {
            e.preventDefault()
            setOpen(false)
            return
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHover(h => Math.min(options.length - 1, h < 0 ? 0 : h + 1))
            return
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHover(h => Math.max(0, h < 0 ? 0 : h - 1))
            return
        }
        if (e.key === 'Enter') {
            e.preventDefault()
            commit(hover >= 0 ? hover : idxByValue >= 0 ? idxByValue : 0)
            return
        }
    }

    return (
        <div
            ref={wrapRef}
            className={clsx(s.inputContainer, className, open && s.openWrap)}
            style={disabled ? { pointerEvents: 'none', opacity: 0.6 } : {}}
            role="button"
            aria-expanded={open}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onClick={e => {
                if (listRef.current && listRef.current.contains(e.target as Node)) return
                toggle()
            }}
        >
            <div className={s.label}>
                {label}
                {description && (
                    <TooltipButton className={s.tip} side="right" tooltipText={<div className={s.itemName}>{description}</div>}>
                        <MdHelp size={14} color="white" />
                    </TooltipButton>
                )}
            </div>
            <div className={clsx(s.valueLine)}>
                <span className={clsx(s.value, !selected && s.placeholder)}>{selected ? selected.label : placeholder}</span>
                <MdKeyboardArrowDown className={clsx(s.arrow, open && s.arrowOpen)} size={18} />
            </div>

            {open && (
                <div ref={listRef} className={clsx(s.panel, alignRight && s.right)} style={{ minWidth: panelW }} onClick={e => e.stopPropagation()}>
                    <div className={s.list} role="listbox">
                        {options.map((o, i) => {
                            const active = String(o.value) === String(value)
                            return (
                                <button
                                    key={String(o.value)}
                                    type="button"
                                    className={clsx(s.option, active && s.active, hover === i && s.hover)}
                                    role="option"
                                    aria-selected={active}
                                    onMouseEnter={() => setHover(i)}
                                    onClick={() => commit(i)}
                                >
                                    <span className={s.optionLabel}>{o.label}</span>
                                    {active && <MdCheck className={s.check} size={16} />}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

export default SelectInput
