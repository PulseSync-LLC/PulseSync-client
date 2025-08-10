import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import * as s from './FileInput.module.scss'
import TooltipButton from '../../tooltip_button'
import { MdHelp, MdFolderOpen, MdClose } from 'react-icons/md'

type Props = {
    label: string
    description?: string
    className?: string

    value: string
    onChange?: (filePath: string) => void

    accept?: string
    previewSrc?: (p: string) => string

    disabled?: boolean
    placeholder?: string
}

const isImageName = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '')
const isAbsPath = (p: string) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p || '')

const toFilters = (accept?: string): Electron.FileFilter[] | undefined => {
    if (!accept) return undefined
    const exts = accept
        .split(',')
        .map(x => x.trim().replace(/^\./, ''))
        .filter(Boolean)
    if (!exts.length) return undefined
    return [{ name: 'Files', extensions: exts }]
}

const FileInput: React.FC<Props> = ({
    label,
    description,
    className,
    value,
    onChange,
    accept = '',
    previewSrc,
    disabled = false,
    placeholder = 'Выберите файл',
}) => {
    const inputRef = useRef<HTMLInputElement>(null)

    const [text, setText] = useState<string>(value ?? '')
    const [isTyping, setIsTyping] = useState(false)

    const [localPreview, setLocalPreview] = useState<string | null>(null)
    const [dataPreview, setDataPreview] = useState<string | null>(null)
    const [imgLoading, setImgLoading] = useState(false)
    const [imgOk, setImgOk] = useState(false)

    useEffect(() => {
        if (!isTyping) setText(value ?? '')

        if (!value || !isImageName(value)) {
            if (localPreview) URL.revokeObjectURL(localPreview)
            setLocalPreview(null)
            setDataPreview(null)
            setImgOk(false)
            setImgLoading(false)
            return
        }

        setImgOk(false)
        setImgLoading(true)

        if (!isAbsPath(value)) {
            setDataPreview(null)
            setTimeout(() => setImgLoading(false), 0)
            return
        }

        let alive = true
        ;(async () => {
            try {
                const url = await window.desktopEvents?.invoke('file:asDataUrl', value)
                if (!alive) return
                setDataPreview(typeof url === 'string' ? url : null)
            } catch {
                if (!alive) return
                setDataPreview(null)
            } finally {
                if (alive) setImgLoading(false)
            }
        })()

        return () => {
            alive = false
        }
    }, [value])

    useEffect(
        () => () => {
            if (localPreview) URL.revokeObjectURL(localPreview)
        },
        [localPreview],
    )

    const previewUrl = useMemo(() => {
        if (localPreview) return localPreview
        if (dataPreview) return dataPreview
        if (value && isImageName(value) && !isAbsPath(value)) {
            return previewSrc ? previewSrc(value) : value
        }
        return null
    }, [localPreview, dataPreview, value, previewSrc])

    const openPicker = async () => {
        if (disabled) return
        const filePath = await window.desktopEvents?.invoke('dialog:openFile', { filters: toFilters(accept) })
        if (!filePath) return
        commitManual(String(filePath))
    }

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (!f) return

        if (isImageName(f.name)) {
            const url = URL.createObjectURL(f)
            setLocalPreview(prev => {
                if (prev) URL.revokeObjectURL(prev)
                return url
            })
            setImgOk(false)
            setImgLoading(true)
        } else {
            if (localPreview) URL.revokeObjectURL(localPreview)
            setLocalPreview(null)
            setImgOk(false)
            setImgLoading(false)
        }

        const anyFile = f as any
        const filePath = typeof anyFile.path === 'string' && anyFile.path.length ? anyFile.path : f.name
        commitManual(filePath)

        e.target.value = ''
    }

    const commitManual = (v: string) => {
        setText(v)
        onChange?.(v)

        if (!v || !isImageName(v)) {
            if (localPreview) URL.revokeObjectURL(localPreview)
            setLocalPreview(null)
            setDataPreview(null)
            setImgOk(false)
            setImgLoading(false)
        } else {
            if (!isAbsPath(v)) setImgLoading(false)
            else setImgLoading(true)
        }
    }

    const clearAll = (e?: React.MouseEvent) => {
        e?.stopPropagation()
        if (localPreview) URL.revokeObjectURL(localPreview)
        setLocalPreview(null)
        setDataPreview(null)
        setImgOk(false)
        setImgLoading(false)
        setText('')
        onChange?.('')
    }

    const fileName = text ? text.split(/[\\/]/).pop() : ''

    return (
        <div className={clsx(s.inputContainer, className)} style={disabled ? { pointerEvents: 'none', opacity: 0.6 } : {}}>
            <div className={clsx(s.previewWrap, previewUrl && s.hasSurface, imgLoading && s.skeleton)} onClick={openPicker}>
                {previewUrl && (
                    <img
                        className={clsx(s.preview, imgOk && s.loaded)}
                        src={previewUrl}
                        onLoad={() => {
                            setImgOk(true)
                            setImgLoading(false)
                        }}
                        onError={() => {
                            setImgOk(false)
                            setImgLoading(false)
                        }}
                    />
                )}
            </div>

            <div className={s.label} onClick={openPicker}>
                {label}
                {description && (
                    <TooltipButton className={s.tip} side="right" tooltipText={<div className={s.itemName}>{description}</div>}>
                        <MdHelp size={14} color="white" />
                    </TooltipButton>
                )}
            </div>

            <div className={s.box} onClick={openPicker}>
                <input
                    className={s.text}
                    value={text}
                    placeholder={placeholder}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => commitManual(e.target.value)}
                />
                {text && (
                    <button type="button" className={s.clearBtn} title="Очистить" onClick={clearAll}>
                        <MdClose size={16} />
                    </button>
                )}
                <button
                    type="button"
                    className={s.pickBtn}
                    title="Выбрать файл"
                    onClick={e => {
                        e.stopPropagation()
                        openPicker()
                    }}
                >
                    <MdFolderOpen size={18} />
                </button>
            </div>

            <input ref={inputRef} className={s.hidden} type="file" accept={accept} onChange={onFile} tabIndex={-1} />
        </div>
    )
}

export default FileInput
