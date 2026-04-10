const MARKDOWN_PATTERN = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|~~~)|\*\*|__|`|\[[^\]]+\]\([^\)]+\)|\|.+\|/m

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function looksLikeMarkdown(value: string): boolean {
    return MARKDOWN_PATTERN.test(value)
}

export function normalizeStoreAddonChangelogMarkdown(value: unknown): string {
    if (typeof value === 'string') {
        return normalizeText(value)
    }

    if (!Array.isArray(value)) {
        if (value == null) return ''
        return normalizeText(String(value))
    }

    const entries = value.map(item => normalizeText(typeof item === 'string' ? item : String(item ?? ''))).filter(Boolean)

    if (!entries.length) return ''
    if (entries.length === 1) return entries[0]

    if (entries.every(entry => !entry.includes('\n') && !looksLikeMarkdown(entry))) {
        return entries.map(entry => `- ${entry}`).join('\n')
    }

    return entries.join('\n\n')
}
