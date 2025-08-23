import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as s from './ColorInput.module.scss'
import TooltipButton from '../../tooltip_button'
import { MdHelp, MdKeyboardArrowDown } from 'react-icons/md'

type HSVA = { h: number; s: number; v: number; a: number }
type Mode = 'hex' | 'rgb' | 'hsl' | 'hsb'

type Props = {
    label: string
    description?: string
    className?: string

    value: string
    onChange?: (hex: string) => void

    disabled?: boolean
    withAlpha?: boolean
    inputModes?: Mode[]
    defaultMode?: Mode
    onBlur?: React.FocusEventHandler<HTMLDivElement | HTMLInputElement>
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const normHex = (hex: string, withAlpha = true) => {
    const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((hex || '').trim())
    if (!m) return withAlpha ? '#FFFFFFFF' : '#FFFFFF'
    const base = `#${m[1].toUpperCase()}`
    const a = (m[2] ?? (withAlpha ? 'FF' : '')).toUpperCase()
    return withAlpha ? base + a : base
}
const hexToRgba = (hex: string) => {
    const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((hex || '').trim())
    if (!m) return { r: 255, g: 255, b: 255, a: 1 }
    const int = parseInt(m[1], 16)
    const r = (int >> 16) & 255,
        g = (int >> 8) & 255,
        b = int & 255
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1
    return { r, g, b, a }
}
const rgbaToHex = (r: number, g: number, b: number, a = 1, withAlpha = true) => {
    const to2 = (v: number) => v.toString(16).padStart(2, '0').toUpperCase()
    const base = `#${to2(r)}${to2(g)}${to2(b)}`
    return withAlpha ? base + to2(Math.round(clamp(a, 0, 1) * 255)) : base
}
const rgb2hsv = (r: number, g: number, b: number) => {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        d = max - min
    let h = 0
    if (d) {
        switch (max) {
            case r:
                h = ((g - b) / d) % 6
                break
            case g:
                h = (b - r) / d + 2
                break
            default:
                h = (r - g) / d + 4
        }
        h *= 60
        if (h < 0) h += 360
    }
    const s = max === 0 ? 0 : d / max,
        v = max
    return { h, s, v }
}
const hsv2rgb = (h: number, s: number, v: number) => {
    const c = v * s,
        x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
        m = v - c
    let r = 0,
        g = 0,
        b = 0
    if (0 <= h && h < 60) {
        r = c
        g = x
        b = 0
    } else if (60 <= h && h < 120) {
        r = x
        g = c
        b = 0
    } else if (120 <= h && h < 180) {
        r = 0
        g = c
        b = x
    } else if (180 <= h && h < 240) {
        r = 0
        g = x
        b = c
    } else if (240 <= h && h < 300) {
        r = x
        g = 0
        b = c
    } else {
        r = c
        g = 0
        b = x
    }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}
const hsva2hex = (hs: HSVA, withAlpha = true) => {
    const { r, g, b } = hsv2rgb(hs.h, hs.s, hs.v)
    return rgbaToHex(r, g, b, hs.a, withAlpha)
}
const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b)
    let h = 0,
        s = 0
    const l = (max + min) / 2,
        d = max - min
    if (d) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0)
                break
            case g:
                h = (b - r) / d + 2
                break
            default:
                h = (r - g) / d + 4
        }
        h *= 60
    }
    return { h, s, l }
}
const hslToRgb = (h: number, s: number, l: number) => {
    const c = (1 - Math.abs(2 * l - 1)) * s,
        x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
        m = l - c / 2
    let r = 0,
        g = 0,
        b = 0
    if (0 <= h && h < 60) {
        r = c
        g = x
    } else if (60 <= h && h < 120) {
        r = x
        g = c
    } else if (120 <= h && h < 180) {
        g = c
        b = x
    } else if (180 <= h && h < 240) {
        g = x
        b = c
    } else if (240 <= h && h < 300) {
        r = x
        b = c
    } else {
        r = c
        b = x
    }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}

const ColorInput: React.FC<Props> = ({
    label,
    description,
    className,
    value,
    onChange,
    disabled = false,
    withAlpha = true,
    inputModes = ['hex'],
    defaultMode = 'hex',
}) => {
    const modes: Mode[] = Array.from(new Set(inputModes))
    const startMode: Mode = modes.includes(defaultMode) ? defaultMode : modes[0]

    const [open, setOpen] = useState(false)
    const [alignRight, setAlignRight] = useState(false)
    const wrapRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const svRef = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    const [hsva, setHsva] = useState<HSVA>(() => {
        const { r, g, b, a } = hexToRgba(value || '#FFFFFF')
        const { h, s, v } = rgb2hsv(r, g, b)
        return { h, s, v, a }
    })

    const [mode, setMode] = useState<Mode>(startMode)
    const [isTyping, setIsTyping] = useState(false)
    const [text, setText] = useState<string>('')
    const [invalid, setInvalid] = useState(false)

    const formatText = (h: HSVA, m: Mode) => {
        const { r, g, b } = hsv2rgb(h.h, h.s, h.v)
        switch (m) {
            case 'rgb':
                return `rgba(${r}, ${g}, ${b}, ${h.a.toFixed(2)})`
            case 'hsl': {
                const hsl = rgbToHsl(r, g, b)
                return `hsla(${Math.round(hsl.h)}, ${(hsl.s * 100).toFixed(0)}%, ${(hsl.l * 100).toFixed(0)}%, ${h.a.toFixed(2)})`
            }
            case 'hsb':
                return `hsb(${Math.round(h.h)}, ${(h.s * 100).toFixed(0)}%, ${(h.v * 100).toFixed(0)}%)`
            default:
                return hsva2hex(h, withAlpha).toUpperCase()
        }
    }

    useEffect(() => {
        if (!isTyping) setText(formatText(hsva, mode))
    }, [mode])

    useEffect(() => {
        if (isTyping) return
        const normalized = normHex(value || '#FFFFFF', withAlpha)
        const { r, g, b, a } = hexToRgba(normalized)
        const { h, s, v } = rgb2hsv(r, g, b)
        const currentHex = normHex(hsva2hex(hsva, withAlpha), withAlpha)
        if (currentHex !== normalized) setHsva({ h, s, v, a })
        setText(formatText({ h, s, v, a }, mode))
    }, [value, withAlpha])

    useEffect(() => {
        if (!open || !panelRef.current) return
        const rect = panelRef.current.getBoundingClientRect()
        const oobRight = rect.right > window.innerWidth - 8
        const oobLeft = rect.left < 8
        setAlignRight(oobRight && !oobLeft)
    }, [open])

    useEffect(() => {
        const h = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', h)
        return () => document.removeEventListener('mousedown', h)
    }, [])

    const hex = hsva2hex(hsva, withAlpha).toUpperCase()
    const { r, g, b } = hsv2rgb(hsva.h, hsva.s, hsva.v)
    const preview = `rgba(${r}, ${g}, ${b}, ${hsva.a})`
    const hueBg = `linear-gradient(90deg, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)`
    const alphaBg = `linear-gradient(90deg, rgba(${r},${g},${b},0) 0%, rgba(${r},${g},${b},1) 100%)`

    const emit = (next: HSVA) => onChange?.(hsva2hex(next, withAlpha))

    const setApply = (next: HSVA) => {
        setHsva(next)
        setText(formatText(next, mode))
        setInvalid(false)
        emit(next)
    }

    const onSV = (e: React.MouseEvent) => {
        if (!svRef.current) return
        const rect = svRef.current.getBoundingClientRect()
        const x = clamp((e.clientX - rect.left) / rect.width, 0, 1)
        const y = clamp((e.clientY - rect.top) / rect.height, 0, 1)
        setApply({ ...hsva, s: x, v: 1 - y })
    }

    const tryApplyFromText = () => {
        const raw = text.trim()

        let rgba: { r: number; g: number; b: number; a: number } | null = null

        if (mode === 'hex') {
            const h = normHex(raw, withAlpha)
            if (/^#([0-9A-F]{6})([0-9A-F]{2})?$/i.test(h)) {
                const t = hexToRgba(h)
                rgba = { r: t.r, g: t.g, b: t.b, a: withAlpha ? t.a : 1 }
            }
        } else if (mode === 'rgb') {
            const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(raw)
            if (m)
                rgba = {
                    r: clamp(parseFloat(m[1]), 0, 255),
                    g: clamp(parseFloat(m[2]), 0, 255),
                    b: clamp(parseFloat(m[3]), 0, 255),
                    a: withAlpha ? clamp(parseFloat(m[4] ?? '1'), 0, 1) : 1,
                }
        } else if (mode === 'hsl') {
            const m = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(raw)
            if (m) {
                const h = ((parseFloat(m[1]) % 360) + 360) % 360
                const s = clamp(parseFloat(m[2]) / 100, 0, 1)
                const l = clamp(parseFloat(m[3]) / 100, 0, 1)
                const { r, g, b } = hslToRgb(h, s, l)
                rgba = { r, g, b, a: withAlpha ? clamp(parseFloat(m[4] ?? '1'), 0, 1) : 1 }
            }
        } else if (mode === 'hsb') {
            const m = /^hsb\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(raw)
            if (m) {
                const h = ((parseFloat(m[1]) % 360) + 360) % 360
                const s = clamp(parseFloat(m[2]) / 100, 0, 1)
                const v = clamp(parseFloat(m[3]) / 100, 0, 1)
                const { r, g, b } = hsv2rgb(h, s, v)
                rgba = { r, g, b, a: hsva.a }
            }
        }

        if (!rgba) {
            setInvalid(true)
            setText(formatText(hsva, mode))
            return
        }

        const { h, s, v } = rgb2hsv(rgba.r, rgba.g, rgba.b)
        setApply({ h, s, v, a: rgba.a })
    }

    const onInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = e => {
        if (e.key === 'Enter') {
            e.currentTarget.blur()
        }
    }

    useEffect(() => {
        if (!open || !panelRef.current) return
        const rect = panelRef.current.getBoundingClientRect()
        const oobRight = rect.right > window.innerWidth - 8
        const oobLeft = rect.left < 8
        setAlignRight(oobRight && !oobLeft)
    }, [open])

    return (
        <div ref={wrapRef} className={clsx(s.inputContainer, className)} style={disabled ? { pointerEvents: 'none', opacity: 0.6 } : {}}>
            <div className={s.label} onClick={() => setOpen(v => !v)}>
                {label}
                {description && (
                    <TooltipButton className={s.tip} side="right" tooltipText={<div className={s.itemName}>{description}</div>}>
                        <MdHelp size={14} color="white" />
                    </TooltipButton>
                )}
            </div>

            <button type="button" className={s.inline} onClick={() => setOpen(v => !v)}>
                <span className={s.swatch} style={{ background: `rgba(${r}, ${g}, ${b}, ${hsva.a})` }} />
                <span className={s.hexText}>{hex}</span>
            </button>

            {open && (
                <div ref={panelRef} className={clsx(s.panel, alignRight && s.right)} onClick={e => e.stopPropagation()}>
                    <span className={s.caret} />

                    <div
                        ref={svRef}
                        className={s.sv}
                        style={{ backgroundColor: `hsl(${hsva.h} 100% 50%)` }}
                        onMouseDown={e => {
                            dragging.current = true
                            onSV(e)
                        }}
                        onMouseMove={e => {
                            if (dragging.current) onSV(e)
                        }}
                        onMouseUp={() => (dragging.current = false)}
                        onMouseLeave={() => (dragging.current = false)}
                    >
                        <div className={s.svKnob} style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }} />
                    </div>

                    <div className={s.row}>
                        <input
                            type="range"
                            min={0}
                            max={360}
                            value={Math.round(hsva.h)}
                            onChange={e => setApply({ ...hsva, h: Number(e.target.value) })}
                            className={s.slider}
                            style={{ background: hueBg }}
                        />
                    </div>

                    {withAlpha && (
                        <div className={clsx(s.row, s.alphaRow)}>
                            <div className={s.checker} />
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={Math.round(hsva.a * 100)}
                                onChange={e => setApply({ ...hsva, a: Number(e.target.value) / 100 })}
                                className={s.slider}
                                style={{ background: alphaBg }}
                            />
                        </div>
                    )}

                    <div className={s.inputsRow}>
                        {modes.length > 1 && (
                            <div className={s.selectWrap} title="Формат ввода">
                                <select
                                    className={s.select}
                                    value={mode}
                                    onChange={e => {
                                        setMode(e.target.value as Mode)
                                        setText(formatText(hsva, e.target.value as Mode))
                                        setInvalid(false)
                                    }}
                                >
                                    {modes.includes('hex') && <option value="hex">Hex</option>}
                                    {modes.includes('rgb') && <option value="rgb">RGB</option>}
                                    {modes.includes('hsl') && <option value="hsl">HSL</option>}
                                    {modes.includes('hsb') && <option value="hsb">HSB</option>}
                                </select>
                                <MdKeyboardArrowDown className={s.selectArrow} size={18} />
                            </div>
                        )}

                        <input
                            className={clsx(s.text, invalid && s.textInvalid)}
                            value={isTyping ? text : formatText(hsva, mode)}
                            onFocus={() => {
                                setIsTyping(true)
                                setText(formatText(hsva, mode))
                                setInvalid(false)
                            }}
                            onChange={e => setText(e.target.value)}
                            onBlur={() => {
                                setIsTyping(false)
                                tryApplyFromText()
                            }}
                            onKeyDown={onInputKeyDown}
                        />

                        {withAlpha && (
                            <div className={s.opacityBox}>
                                <input
                                    className={s.text}
                                    value={Math.round(hsva.a * 100)}
                                    onChange={e => {
                                        const n = clamp(parseInt(e.target.value || '0', 10), 0, 100)
                                        setApply({ ...hsva, a: n / 100 })
                                    }}
                                />
                                <span className={s.suffix}>%</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default ColorInput
