import { EditorSelection } from '@codemirror/state'

import type { EditorState, TransactionSpec } from '@codemirror/state'

export type MarkdownAction = 'heading' | 'bold' | 'italic' | 'strike' | 'quote' | 'list' | 'orderedList' | 'taskList' | 'code' | 'link' | 'image'

export function formatMarkdown(state: EditorState, action: MarkdownAction, placeholder: string): TransactionSpec {
    const { from, to } = state.selection.main
    const selected = state.sliceDoc(from, to)
    const replace = (start: number, end: number, insert: string, anchor: number, head = anchor): TransactionSpec => ({
        changes: { from: start, to: end, insert },
        selection: EditorSelection.single(anchor, head),
        scrollIntoView: true,
        userEvent: 'input',
    })

    if (action === 'link' || action === 'image') {
        const text = selected || placeholder
        const prefix = action === 'image' ? '![' : '['
        const insert = `${prefix}${text}](https://)`
        const urlStart = from + prefix.length + text.length + 2
        return replace(from, to, insert, urlStart, urlStart + 8)
    }

    const markers = { bold: '**', italic: '*', strike: '~~', code: '`' }
    if (action in markers && !(action === 'code' && selected.includes('\n'))) {
        const marker = markers[action as keyof typeof markers]
        if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
            const text = selected.slice(marker.length, -marker.length)
            return replace(from, to, text, from, from + text.length)
        }
        if (state.sliceDoc(Math.max(0, from - marker.length), from) === marker && state.sliceDoc(to, to + marker.length) === marker) {
            return replace(from - marker.length, to + marker.length, selected, from - marker.length, to - marker.length)
        }
        const text = selected || placeholder
        return replace(from, to, `${marker}${text}${marker}`, from + marker.length, from + marker.length + text.length)
    }

    const first = state.doc.lineAt(from)
    const last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to)
    const text = state.sliceDoc(first.from, last.to)
    if (action === 'code') {
        const content = text || placeholder
        const fence = '`'.repeat(Math.max(3, ...Array.from(content.matchAll(/`+/g), match => match[0].length + 1)))
        return replace(
            first.from,
            last.to,
            `${fence}\n${content}\n${fence}`,
            first.from + fence.length + 1,
            first.from + fence.length + 1 + content.length,
        )
    }

    const prefixes = {
        heading: { pattern: /^#{1,6}\s/, prefix: () => '## ' },
        quote: { pattern: /^>\s?/, prefix: () => '> ' },
        list: { pattern: /^[-+*]\s/, prefix: () => '- ' },
        orderedList: { pattern: /^\d+[.)]\s/, prefix: (index: number) => `${index + 1}. ` },
        taskList: { pattern: /^[-+*]\s\[[ xX]\]\s/, prefix: () => '- [ ] ' },
    }
    const { pattern, prefix } = prefixes[action as keyof typeof prefixes]
    const lines = (text || placeholder).split('\n')
    const remove = lines.every(line => pattern.test(line))
    const insert = lines.map((line, index) => (remove ? line.replace(pattern, '') : `${prefix(index)}${line}`)).join('\n')
    return replace(first.from, last.to, insert, first.from, first.from + insert.length)
}
