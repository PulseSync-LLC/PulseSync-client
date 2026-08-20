import React, { useEffect, useMemo, useRef, useState } from 'react'

import clsx from 'clsx'
import path from 'path'
import { useTranslation } from 'react-i18next'
import { MdClose, MdFolderOpen, MdHelp } from 'react-icons/md'

import { desktopApi } from '@shared/desktop/desktopApi'
import TooltipButton from '@shared/ui/tooltip_button'

import * as s from '@shared/ui/PSUI/FileInput/FileInput.module.scss'

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

    metadata?: boolean
    addonPath?: string
    preferredBaseName?: string
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const isImageName = (name: string) => IMAGE_EXTS.has(path.extname(name || '').toLowerCase())
const isAbsPath = (p: string) => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p || '')
const revokeIfBlob = (url?: string | null) => {
    if (url) URL.revokeObjectURL(url)
}

const toFilters = (accept?: string): Electron.FileFilter[] | undefined => {
    if (!accept) return undefined
    const exts = accept
        .split(',')
        .map(x => x.trim().replace(/^\./, ''))
        .filter(Boolean)
    if (!exts.length) return undefined
    return [{ name: 'Files', extensions: exts }]
}

function sanitizeFilename(name: string) {
    return name
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .trim()
}

async function ensureCopyIntoAddon(addonPath: string, absSourcePath: string, preferredName?: string): Promise<string> {
    const src = path.normalize(absSourcePath)
    const root = path.normalize(addonPath) + path.sep

    if (src.startsWith(root)) {
        return path.relative(addonPath, src).replace(/\\/g, '/')
    }

    const baseName = sanitizeFilename(preferredName || path.basename(src))
    const ext = path.extname(baseName)
    const stem = baseName.slice(0, baseName.length - ext.length)

    const result = await desktopApi.addons.files.copyInto({
        addonPath,
        preferredName: `${stem}${ext}`,
        sourcePath: src,
    })
    if (!result.success || !result.relativePath) {
        throw new Error(result.error || 'ADDON_FILE_COPY_FAILED')
    }
    return result.relativePath
}

async function getDataUrlSafe(fullPath: string): Promise<string | null> {
    try {
        const url = await desktopApi.addons.files.asDataUrl(fullPath)
        if (url) return url
    } catch {}
    try {
        const b64 = await desktopApi.addons.files.readBase64(fullPath)
        if (!b64) return null
        const ext = path.extname(fullPath).toLowerCase()
        const mime =
            ext === '.png'
                ? 'image/png'
                : ext === '.jpg' || ext === '.jpeg'
                  ? 'image/jpeg'
                  : ext === '.gif'
                    ? 'image/gif'
                    : ext === '.webp'
                      ? 'image/webp'
                      : ext === '.bmp'
                        ? 'image/bmp'
                        : ext === '.svg'
                          ? 'image/svg+xml'
                          : 'application/octet-stream'
        return `data:${mime};base64,${b64}`
    } catch {
        return null
    }
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
    placeholder,
    metadata = false,
    addonPath,
    preferredBaseName,
}) => {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLInputElement>(null)
    const placeholderText = placeholder ?? t('common.selectFile')

    const [text, setText] = useState<string>(value ?? '')
    const [isTyping, setIsTyping] = useState(false)

    const [localPreview, setLocalPreview] = useState<string | null>(null)
    const [dataPreview, setDataPreview] = useState<string | null>(null)
    const [imgLoading, setImgLoading] = useState(false)
    const [imgOk, setImgOk] = useState(false)

    const [rev, setRev] = useState(0)

    const resetPreviewState = () => {
        setLocalPreview(prev => {
            revokeIfBlob(prev)
            return null
        })
        setDataPreview(null)
        setImgOk(false)
        setImgLoading(false)
    }

    useEffect(() => {
        if (!isTyping) setText(value ?? '')

        if (!value || !isImageName(value)) {
            resetPreviewState()
            return
        }

        setImgOk(false)
        setImgLoading(true)

        const load = async () => {
            if (isAbsPath(value)) {
                const url = await getDataUrlSafe(value)
                setDataPreview(typeof url === 'string' ? url : null)
                setImgLoading(false)
                return
            }
            if (metadata && addonPath) {
                const full = path.join(addonPath, value)
                const url = await getDataUrlSafe(full)
                setDataPreview(typeof url === 'string' ? url : null)
                setImgLoading(false)
                return
            }
            setDataPreview(null)
            setImgLoading(false)
        }

        let alive = true
        load().finally(() => {
            if (alive) setImgLoading(false)
        })
        return () => {
            alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, metadata, addonPath, rev])

    useEffect(
        () => () => {
            revokeIfBlob(localPreview)
        },
        [localPreview],
    )

    const previewUrl = useMemo(() => {
        if (localPreview) return localPreview
        if (dataPreview) return `${dataPreview}#r=${rev}` // cache-bust
        if (value && isImageName(value) && !isAbsPath(value)) {
            const src = previewSrc ? previewSrc(value) : null
            return src ? `${src}#r=${rev}` : null
        }
        return null
    }, [localPreview, dataPreview, value, previewSrc, rev])

    const openPicker = async () => {
        if (disabled) return
        const filters = toFilters(accept)
        let defaultPath: string | undefined = undefined

        if ((accept.includes('.css') || accept.includes('.js')) && addonPath) {
            defaultPath = addonPath
        }
        const filePath = await desktopApi.addons.files.openDialog({ filters, defaultPath, metadata })
        if (!filePath) return
        if (metadata && addonPath) await commitPicked(String(filePath))
        else commitManual(String(filePath))
    }

    const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0]
        if (!f) return

        if (isImageName(f.name)) {
            const url = URL.createObjectURL(f)
            setLocalPreview(prev => {
                revokeIfBlob(prev)
                return url
            })
            setImgOk(false)
            setImgLoading(true)
        } else {
            resetPreviewState()
        }

        const anyFile = f as any
        const filePath = typeof anyFile.path === 'string' && anyFile.path.length ? anyFile.path : f.name

        if (metadata && addonPath) await commitPicked(filePath)
        else commitManual(filePath)

        e.target.value = ''
    }

    const commitManual = (v: string) => {
        setText(v)
        onChange?.(v)
        if (!v || !isImageName(v)) {
            resetPreviewState()
        } else {
            if (!isAbsPath(v)) setImgLoading(false)
            else setImgLoading(true)
        }
    }

    const commitPicked = async (absNewPath: string) => {
        if (!metadata || !addonPath) {
            commitManual(absNewPath)
            return
        }

        const prevShort = text && !isAbsPath(text) ? text : null
        let finalShort = prevShort || ''

        try {
            if (isAbsPath(absNewPath)) {
                if (prevShort) {
                    await desktopApi.addons.files.copyInto({
                        addonPath,
                        existingRelativePath: prevShort,
                        sourcePath: absNewPath,
                    })
                    setRev(r => r + 1)
                    finalShort = prevShort
                } else {
                    const ext = path.extname(absNewPath)
                    const preferred = preferredBaseName ? `${preferredBaseName}${ext || ''}` : undefined
                    finalShort = await ensureCopyIntoAddon(addonPath, absNewPath, preferred)
                    setRev(r => r + 1)
                }
            } else {
                finalShort = absNewPath
                setRev(r => r + 1)
            }
        } catch {
            finalShort = prevShort || absNewPath
            setRev(r => r + 1)
        }

        setText(finalShort)
        onChange?.(finalShort)

        if (!finalShort || !isImageName(finalShort)) {
            resetPreviewState()
        } else {
            setImgLoading(true)
        }
    }

    const clearAll = async (e?: React.MouseEvent) => {
        e?.stopPropagation()
        resetPreviewState()
        setText('')
        onChange?.('')
        setRev(r => r + 1)
    }

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
                    placeholder={placeholderText}
                    onFocus={() => setIsTyping(true)}
                    onBlur={() => setIsTyping(false)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => commitManual(e.target.value)}
                />
                {text && (
                    <button type="button" className={s.clearBtn} title={t('common.clear')} onClick={clearAll}>
                        <MdClose size={16} />
                    </button>
                )}
                <button
                    type="button"
                    className={s.pickBtn}
                    title={t('common.selectFile')}
                    onClick={async e => {
                        e.stopPropagation()
                        await openPicker()
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
