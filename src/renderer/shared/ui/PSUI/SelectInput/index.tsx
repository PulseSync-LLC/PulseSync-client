import React, { ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import * as s from '@shared/ui/PSUI/SelectInput/SelectInput.module.scss'
import TooltipButton from '@shared/ui/tooltip_button'
import { MdHelp, MdKeyboardArrowDown, MdCheck } from 'react-icons/md'
import { useTranslation } from 'react-i18next'

type Option = { value: string | number; label: string; searchText?: string }

type Props = {
    label: string
    description?: ReactElement | string
    className?: string
    value: string | number | null | undefined
    options: Option[]
    onChange?: (v: string | number) => void
    disabled?: boolean
    placeholder?: string
    searchable?: boolean
    searchPlaceholder?: string
}

const SelectInput: React.FC<Props> = ({
    label,
    description,
    className,
    value,
    options,
    onChange,
    disabled = false,
    placeholder,
    searchable = false,
    searchPlaceholder,
}) => {
    const { t } = useTranslation()
    const placeholderText = placeholder ?? t('common.selectPlaceholder')
    const searchPlaceholderText = searchPlaceholder ?? t('common.selectPlaceholder')
    const [open, setOpen] = useState(false)
    const [openUpward, setOpenUpward] = useState(false)
    const [panelLeft, setPanelLeft] = useState(12)
    const [panelTop, setPanelTop] = useState<number | undefined>(undefined)
    const [panelBottom, setPanelBottom] = useState<number | undefined>(undefined)
    const [panelW, setPanelW] = useState(260)
    const [panelMaxHeight, setPanelMaxHeight] = useState<number>(360)
    const [listMaxHeight, setListMaxHeight] = useState<number>(280)
    const [hover, setHover] = useState<number>(-1)
    const [searchQuery, setSearchQuery] = useState('')

    const wrapRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)

    const filteredOptions = useMemo(() => {
        const normalizedQuery = searchQuery.trim().toLowerCase()
        if (!searchable || !normalizedQuery) {
            return options
        }

        return options.filter(option => String(option.searchText ?? option.label).trim().toLowerCase().includes(normalizedQuery))
    }, [options, searchable, searchQuery])

    const idxByValue = useMemo(() => filteredOptions.findIndex(o => String(o.value) === String(value)), [filteredOptions, value])
    const selected = useMemo(() => options.find(o => String(o.value) === String(value)) ?? null, [options, value])

    const updatePanelLayout = useCallback(() => {
        const rect = wrapRef.current?.getBoundingClientRect()
        if (!rect) return

        const viewportPadding = 12
        const panelGap = 8
        const desiredPanelWidth = Math.max(rect.width, 260)
        const panelWidth = Math.min(desiredPanelWidth, window.innerWidth - viewportPadding * 2)
        const availableBelow = window.innerHeight - rect.bottom - panelGap - viewportPadding
        const availableAbove = rect.top - panelGap - viewportPadding
        const estimatedPanelHeight = searchable ? 360 : 300
        const preferUpward = availableBelow < estimatedPanelHeight && availableAbove > availableBelow
        const availableSpace = preferUpward ? availableAbove : availableBelow
        const reservedHeight = searchable ? 76 : 12
        const nextPanelMaxHeight = Math.max(140, Math.min(360, availableSpace))
        const nextPanelLeft = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - viewportPadding - panelWidth)

        setPanelW(panelWidth)
        setPanelLeft(nextPanelLeft)
        setOpenUpward(preferUpward)
        setPanelTop(preferUpward ? undefined : rect.bottom + panelGap)
        setPanelBottom(preferUpward ? window.innerHeight - rect.top + panelGap : undefined)
        setPanelMaxHeight(nextPanelMaxHeight)
        setListMaxHeight(Math.max(72, nextPanelMaxHeight - reservedHeight))
    }, [searchable])

    useEffect(() => {
        const h = (e: MouseEvent) => {
            const target = e.target as Node
            if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return
            setOpen(false)
            setSearchQuery('')
        }
        document.addEventListener('mousedown', h)
        return () => document.removeEventListener('mousedown', h)
    }, [])

    useLayoutEffect(() => {
        if (!open) return

        updatePanelLayout()
        window.addEventListener('resize', updatePanelLayout)
        window.addEventListener('scroll', updatePanelLayout, true)

        return () => {
            window.removeEventListener('resize', updatePanelLayout)
            window.removeEventListener('scroll', updatePanelLayout, true)
        }
    }, [open, updatePanelLayout])

    const commit = (i: number) => {
        const opt = filteredOptions[i]
        if (!opt) return
        onChange?.(opt.value)
        setOpen(false)
        setSearchQuery('')
    }

    const toggle = () => {
        if (disabled) return
        setOpen(v => {
            const next = !v
            if (next) {
                updatePanelLayout()
                setHover(idxByValue >= 0 ? idxByValue : 0)
            }
            else setSearchQuery('')
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
            setHover(h => Math.min(filteredOptions.length - 1, h < 0 ? 0 : h + 1))
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
                <span className={clsx(s.value, !selected && s.placeholder)}>{selected ? selected.label : placeholderText}</span>
                <MdKeyboardArrowDown className={clsx(s.arrow, open && s.arrowOpen)} size={18} />
            </div>

            {open &&
                createPortal(
                    <div
                        ref={listRef}
                        className={clsx(s.panel, openUpward && s.up)}
                        style={{
                            left: panelLeft,
                            top: panelTop,
                            bottom: panelBottom,
                            width: panelW,
                            maxHeight: panelMaxHeight,
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {searchable && (
                            <div className={s.searchWrap}>
                                <input
                                    className={s.searchInput}
                                    value={searchQuery}
                                    onChange={event => {
                                        setSearchQuery(event.target.value)
                                        setHover(0)
                                    }}
                                    placeholder={searchPlaceholderText}
                                />
                            </div>
                        )}
                        <div className={s.list} role="listbox" style={{ maxHeight: listMaxHeight }}>
                            {filteredOptions.map((o, i) => {
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
                    </div>,
                    document.body,
                )}
        </div>
    )
}

export default SelectInput
