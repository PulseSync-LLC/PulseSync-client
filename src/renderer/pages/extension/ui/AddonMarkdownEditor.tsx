import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useTranslation } from 'react-i18next'
import {
    MdCheckBox,
    MdCode,
    MdFormatBold,
    MdFormatItalic,
    MdFormatListBulleted,
    MdFormatListNumbered,
    MdFormatQuote,
    MdImage,
    MdLink,
    MdRedo,
    MdStrikethroughS,
    MdTitle,
    MdUndo,
} from 'react-icons/md'

import { formatMarkdown } from '../model/markdownCommands'

import * as styles from './AddonMarkdownEditor.module.scss'

import type { MarkdownAction } from '../model/markdownCommands'
import type { ReactNode } from 'react'

type Props = {
    value: string
    label: string
    disabled: boolean
    onChange: (value: string) => void
    onSave: () => Promise<unknown>
    renderPreview: (value: string) => ReactNode
}

const tools = [
    ['heading', MdTitle],
    ['bold', MdFormatBold],
    ['italic', MdFormatItalic],
    ['strike', MdStrikethroughS],
    ['quote', MdFormatQuote],
    ['list', MdFormatListBulleted],
    ['orderedList', MdFormatListNumbered],
    ['taskList', MdCheckBox],
    ['code', MdCode],
    ['link', MdLink],
    ['image', MdImage],
] as const
const toolbarTools = [...tools, ['undo', MdUndo], ['redo', MdRedo]] as const

const theme = EditorView.theme(
    {
        '&': { height: '100%', color: 'var(--text-primary)', backgroundColor: 'transparent', fontSize: '13px' },
        '.cm-scroller': { fontFamily: 'Consolas, "Courier New", monospace', lineHeight: '1.7', overflow: 'auto' },
        '.cm-content': { padding: '4px 0', minHeight: '360px', caretColor: 'var(--text-primary)' },
        '.cm-content, .cm-content *': { userSelect: 'text' },
        '.cm-line': { padding: '0 6px' },
        '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-secondary)', borderRight: '1px solid var(--border)' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--hover)' },
        '&.cm-focused': { outline: 'none' },
        '.cm-cursor': { borderLeftColor: 'var(--text-primary)' },
        '.cm-selectionBackground': { backgroundColor: '#3b526e' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: '#365f91' },
        '.cm-panels': { backgroundColor: 'var(--background)', color: 'var(--text-primary)' },
        '.cm-textfield, .cm-button': { background: 'var(--background)', color: 'var(--text-primary)', border: '1px solid var(--border)' },
        '.cm-searchMatch': { backgroundColor: '#aa8b354d' },
        '.cm-searchMatch-selected': { backgroundColor: '#aa8b3580' },
    },
    { dark: true },
)

const highlighting = syntaxHighlighting(
    HighlightStyle.define([
        { tag: tags.heading, color: 'var(--text-primary)', fontWeight: 'bold' },
        { tag: tags.strong, fontWeight: 'bold' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.strikethrough, textDecoration: 'line-through' },
        { tag: [tags.link, tags.url], color: '#8bcecf' },
        { tag: tags.monospace, color: '#edc38a' },
        { tag: [tags.meta, tags.processingInstruction], color: 'var(--text-secondary)' },
    ]),
)

export default function AddonMarkdownEditor({ value, label, disabled, onChange, onSave, renderPreview }: Props) {
    const { t } = useTranslation()
    const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('split')
    const container = useRef<HTMLDivElement>(null)
    const editor = useRef<EditorView | null>(null)
    const initialValue = useRef(value)
    const lineBreak = useRef(value.match(/\r\n|\r|\n/)?.[0] ?? '\n')
    const [options] = useState(() => new Compartment())
    const deferredValue = useDeferredValue(value)
    const preview = useMemo(() => renderPreview(deferredValue), [deferredValue, renderPreview])
    const handleChange = useEffectEvent(onChange)
    const handleSave = useEffectEvent(onSave)
    const placeholder = useEffectEvent(() => t('extensions.project.markdown.text'))

    useEffect(() => {
        if (!container.current) return
        const format = (action: MarkdownAction) => (view: EditorView) => {
            if (view.state.readOnly) return false
            view.dispatch(formatMarkdown(view.state, action, placeholder()))
            return true
        }
        const view = new EditorView({
            parent: container.current,
            state: EditorState.create({
                doc: initialValue.current,
                extensions: [
                    options.of([]),
                    theme,
                    highlighting,
                    lineNumbers(),
                    drawSelection(),
                    highlightActiveLine(),
                    history(),
                    markdown({ base: markdownLanguage }),
                    highlightSelectionMatches(),
                    EditorView.lineWrapping,
                    keymap.of([
                        { key: 'Mod-b', run: format('bold') },
                        { key: 'Mod-i', run: format('italic') },
                        { key: 'Mod-k', run: format('link') },
                        {
                            key: 'Mod-s',
                            run: current => {
                                if (!current.state.readOnly) void handleSave()
                                return true
                            },
                        },
                        ...defaultKeymap,
                        ...historyKeymap,
                        ...searchKeymap,
                        indentWithTab,
                    ]),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) handleChange(update.state.doc.toString().replace(/\n/g, lineBreak.current))
                    }),
                ],
            }),
        })
        editor.current = view
        return () => {
            editor.current = null
            view.destroy()
        }
    }, [options])

    useEffect(() => {
        editor.current?.dispatch({
            effects: options.reconfigure([
                EditorState.readOnly.of(disabled),
                EditorView.editable.of(!disabled),
                EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
            ]),
        })
    }, [disabled, label, options])

    useEffect(() => {
        const view = editor.current
        if (view && view.state.doc.toString() !== value.replace(/\r\n?/g, '\n')) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) })
        }
    }, [value])

    useEffect(() => {
        editor.current?.requestMeasure()
    }, [mode])

    const run = (action: MarkdownAction | 'undo' | 'redo') => {
        const view = editor.current
        if (!view || disabled) return
        if (action === 'undo') undo(view)
        else if (action === 'redo') redo(view)
        else view.dispatch(formatMarkdown(view.state, action, t('extensions.project.markdown.text')))
        view.focus()
    }

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                <div className={styles.tools} role="group" aria-label={t('extensions.project.markdown.formatting')}>
                    {toolbarTools.map(([action, Icon]) => (
                        <button
                            key={action}
                            type="button"
                            disabled={disabled || mode === 'preview'}
                            title={t(`extensions.project.markdown.${action}`)}
                            aria-label={t(`extensions.project.markdown.${action}`)}
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => run(action)}
                        >
                            <Icon size={18} aria-hidden="true" />
                        </button>
                    ))}
                </div>
                <div className={styles.modes} role="group" aria-label={t('extensions.project.markdown.view')}>
                    {(['edit', 'split', 'preview'] as const).map(item => (
                        <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}>
                            {t(`extensions.project.markdown.${item}`)}
                        </button>
                    ))}
                </div>
            </div>
            <div className={styles.panes} data-mode={mode}>
                <div className={styles.source} hidden={mode === 'preview'}>
                    <div className={styles.paneLabel}>Markdown</div>
                    <div className={styles.editor} ref={container} />
                </div>
                <div className={styles.preview} hidden={mode === 'edit'}>
                    <div className={styles.paneLabel}>{t('extensions.project.preview')}</div>
                    <div className={styles.previewContent}>
                        {deferredValue.trim() ? preview : <p className={styles.empty}>{t('extensions.project.markdown.empty')}</p>}
                    </div>
                </div>
            </div>
        </div>
    )
}
