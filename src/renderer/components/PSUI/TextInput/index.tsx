import React, { useState, useRef, useEffect, useCallback } from 'react'
import * as styles from './TextInput.module.scss'
import TooltipButton from '../../tooltip_button'
import { MdHelp, MdKeyboardCommandKey } from 'react-icons/md'
import clsx from 'clsx'
import ButtonV2 from '../../buttonV2'

interface TextInputProps {
    name: string
    label: string
    description?: string
    placeholder?: string
    className?: string
    ariaLabel?: string
    value: string
    error?: string
    touched?: boolean
    onChange?: (value: string) => void
    onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void
    showCommandsButton?: boolean
}

const commands = [
    { key: '{track}', label: 'название трека' },
    { key: '{artist}', label: 'имя артиста' },
    { key: '{album}', label: 'название альбома' },
]

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
}) => {
    const [isFocused, setIsFocused] = useState(false)
    const [commandsVisible, setCommandsVisible] = useState(false)
    const editorRef = useRef<HTMLDivElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const lastValueRef = useRef(value)
    const rafRef = useRef<number | null>(null)
    const selectionRef = useRef<{ start: number; end: number } | null>(null)

    const saveSelection = useCallback(() => {
        const sel = window.getSelection()
        if (!sel?.rangeCount || !editorRef.current) return

        const range = sel.getRangeAt(0)
        const pre = range.cloneRange()
        pre.selectNodeContents(editorRef.current)
        pre.setEnd(range.startContainer, range.startOffset)
        const start = pre.toString().length
        selectionRef.current = { start, end: start + range.toString().length }
    }, [])

    useEffect(() => {
        const container = editorRef.current
        if (!container) return
        if (value) {
            container.textContent = value
        } else {
            container.innerHTML = ''
        }
        lastValueRef.current = value
        const range = document.createRange()
        range.selectNodeContents(container)
        range.collapse(false)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
    }, [value])

    const handleInput = () => {
        if (!editorRef.current) return
        const newValue = editorRef.current.textContent?.replace(/\u200B/g, '') || ''
        if (newValue !== lastValueRef.current) {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            rafRef.current = requestAnimationFrame(() => {
                saveSelection()
                onChange?.(newValue)
                lastValueRef.current = newValue
            })
        }
        if (newValue === '' && editorRef.current.innerHTML !== '<br>') {
            editorRef.current.innerHTML = '<br>'
        }
    }

    const setCursorToEnd = () => {
        const el = editorRef.current
        if (!el) return
        const range = document.createRange()
        const sel = window.getSelection()
        range.selectNodeContents(el)
        range.collapse(false)
        sel?.removeAllRanges()
        sel?.addRange(range)
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
                    onFocus={() => setIsFocused(true)}
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
                        {commands.map(cmd => (
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
