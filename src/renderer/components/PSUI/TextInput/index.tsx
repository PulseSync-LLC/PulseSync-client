import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import * as styles from './TextInput.module.scss'
import TooltipButton from '../../tooltip_button'
import { MdHelp, MdKeyboardCommandKey } from 'react-icons/md'
import clsx from 'clsx'
import ButtonV2 from '../../buttonV2'

interface TextInputProps {
    name: string
    label: string
    description?: React.ReactNode
    placeholder?: string
    className?: string
    ariaLabel?: string
    value: string
    error?: string
    touched?: boolean
    onChange?: (value: string) => void
    onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void
    showCommandsButton?: boolean
    commandsType?: 'music' | 'status'
}

const STATUS_DISPLAY_TYPES: Record<number, number> = {
    0: 0,
    1: 1,
    2: 2,
}

const STATUS_DISPLAY_NAMES: Record<number, string> = {
    0: 'Название приложения',
    1: 'Автор трека',
    2: 'Название трека',
}

const musicCommands = [
    { key: '{track}', label: 'название трека' },
    { key: '{artist}', label: 'имя артиста' },
    { key: '{album}', label: 'название альбома' },
]

const statusCommands = Object.keys(STATUS_DISPLAY_TYPES).map(k => {
    const num = Number(k)
    return {
        key: k,
        label: STATUS_DISPLAY_NAMES[num],
    }
})

function getTextNodes(root: Node): Text[] {
    const out: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            return (node.textContent && node.textContent.length >= 0)
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT
        }
    })
    let n = walker.nextNode()
    while (n) {
        out.push(n as Text)
        n = walker.nextNode()
    }
    return out
}

function restoreSelectionByOffsets(root: HTMLElement, start: number, end: number) {
    const textNodes = getTextNodes(root)
    const totalLen = textNodes.reduce((acc, t) => acc + (t.textContent?.length ?? 0), 0)

    const s = Math.max(0, Math.min(start, totalLen))
    const e = Math.max(0, Math.min(end, totalLen))

    let rangeStartNode: Text | HTMLElement = root
    let rangeStartOffset = 0
    let rangeEndNode: Text | HTMLElement = root
    let rangeEndOffset = 0

    let acc = 0
    for (const tn of textNodes) {
        const len = tn.textContent?.length ?? 0
        const next = acc + len

        if (s >= acc && s <= next) {
            rangeStartNode = tn
            rangeStartOffset = s - acc
        }
        if (e >= acc && e <= next) {
            rangeEndNode = tn
            rangeEndOffset = e - acc
        }
        acc = next
    }

    const range = document.createRange()
    try {
        if (textNodes.length === 0) {
            range.selectNodeContents(root)
            range.collapse(false)
        } else {
            range.setStart(rangeStartNode, rangeStartOffset)
            range.setEnd(rangeEndNode, rangeEndOffset)
        }
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
    } catch {
        range.selectNodeContents(root)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
    }
}

const TextInput: React.FC<TextInputProps> = ({
    name,
    label,
    description,
    placeholder,
    className = '',
    ariaLabel,
    value,
    error,
    touched,
    onChange,
    onBlur,
    showCommandsButton = false,
    commandsType = 'music',
}) => {
    const [isFocused, setIsFocused] = useState(false)
    const [commandsVisible, setCommandsVisible] = useState(false)
    const editorRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const lastValueRef = useRef(value)
    const rafRef = useRef<number | null>(null)

    const selectionRef = useRef<{ start: number; end: number } | null>(null)

    const activeCommands = commandsType === 'status' ? statusCommands : musicCommands

    const saveSelection = useCallback(() => {
        const root = editorRef.current
        const sel = window.getSelection()
        if (!root || !sel || sel.rangeCount === 0) return

        const range = sel.getRangeAt(0)

        const pre = range.cloneRange()
        pre.selectNodeContents(root)
        pre.setEnd(range.startContainer, range.startOffset)
        const start = pre.toString().length

        selectionRef.current = { start, end: start + range.toString().length }
    }, [])

    const setCursorToEnd = useCallback(() => {
        const el = editorRef.current
        if (!el) return
        const range = document.createRange()
        const sel = window.getSelection()
        range.selectNodeContents(el)
        range.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(range)
    }, [])

    useLayoutEffect(() => {
        const el = editorRef.current
        if (!el) return

        const currentDOMText = (el.textContent || '').replace(/\u200B/g, '')
        if (currentDOMText !== value) {
            if (value) {
                el.textContent = value
            } else {
                el.innerHTML = '<br>'
            }
        }
        lastValueRef.current = value

        const hasFocus = document.activeElement === el

        if (hasFocus) {
            if (selectionRef.current) {
                const { start, end } = selectionRef.current
                restoreSelectionByOffsets(el, start, end)
            } else {
                setCursorToEnd()
            }
        }
    }, [value, setCursorToEnd])

    const handleInput = () => {
        const root = editorRef.current
        if (!root) return
        const newValue = root.textContent?.replace(/\u200B/g, '') || ''

        if (newValue !== lastValueRef.current) {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            // Сначала сохраняем позицию относительно текущего DOM
            saveSelection()
            rafRef.current = requestAnimationFrame(() => {
                onChange?.(newValue)
                lastValueRef.current = newValue
            })
        }

        if (newValue === '' && root.innerHTML !== '<br>') {
            root.innerHTML = '<br>'
        }
    }

    const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!editorRef.current) return
        const wasClickInsideInput = editorRef.current.contains(e.target as Node)
        editorRef.current.focus()
        if (!wasClickInsideInput) {
            setCursorToEnd()
        }
    }

    const insertCommandAtCursor = (cmd: string) => {
        const el = editorRef.current
        if (!el) return
        el.focus()
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const textNode = document.createTextNode(cmd)
        range.insertNode(textNode)
        range.setStartAfter(textNode)
        range.setEndAfter(textNode)
        sel.removeAllRanges()
        sel.addRange(range)
        handleInput()
        saveSelection()
        setCommandsVisible(false)
    }

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node) && !editorRef.current?.contains(e.target as Node)) {
                setCommandsVisible(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [])

    return (
        <div ref={containerRef} className={clsx(styles.inputContainer, className)} onClick={handleContainerClick}>
            <div className={styles.label}>
                {label}
                {description && (
                    <TooltipButton className={styles.tip} side="right" tooltipText={<div className={styles.itemName}>{description}</div>}>
                        <MdHelp size={14} color="white" />
                    </TooltipButton>
                )}
            </div>

            <div className={styles.control}>
                <div
                    ref={editorRef}
                    id={name}
                    role="textbox"
                    contentEditable
                    suppressContentEditableWarning
                    className={clsx(styles.textInput, {
                        [styles.focused]: isFocused,
                        [styles.placeholder]: !value,
                    })}
                    data-placeholder={placeholder}
                    spellCheck="true"
                    aria-label={ariaLabel}
                    aria-multiline="true"
                    aria-invalid={Boolean(touched && error)}
                    aria-errormessage={touched && error ? `${name}-error` : undefined}
                    onInput={handleInput}
                    onFocus={() => {
                        setIsFocused(true)
                        saveSelection()
                    }}
                    onKeyUp={saveSelection}
                    onMouseUp={saveSelection}
                    onBlur={e => {
                        setIsFocused(false)
                        onBlur?.(e)
                    }}
                />
                {showCommandsButton && (
                    <ButtonV2 className={styles.controlButton} onClick={() => setCommandsVisible(prev => !prev)}>
                        <MdKeyboardCommandKey size={22} color={commandsVisible ? 'white' : undefined} />
                    </ButtonV2>
                )}
            </div>

            {commandsVisible && (
                <div className={styles.commandWrapper}>
                    <div className={styles.commandList}>
                        {activeCommands.map(cmd => (
                            <button key={cmd.key} className={styles.commandButton} onClick={() => insertCommandAtCursor(cmd.key)}>
                                <div className={styles.commandInfo}>
                                    <div className={styles.commandPreview}>{cmd.key}</div> — {cmd.label}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {touched && error && (
                <div id={`${name}-error`} className={styles.error}>
                    {error}
                </div>
            )}
        </div>
    )
}

export default TextInput
