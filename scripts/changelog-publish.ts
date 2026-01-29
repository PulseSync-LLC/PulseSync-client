import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'

enum LogLevel {
    INFO = 'INFO',
    SUCCESS = 'SUCCESS',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

function log(level: LogLevel, message: string): void {
    const ts = new Date().toLocaleString()
    const tag = {
        [LogLevel.INFO]: chalk.blue('[INFO] '),
        [LogLevel.SUCCESS]: chalk.green('[SUCCESS]'),
        [LogLevel.WARN]: chalk.yellow('[WARN] '),
        [LogLevel.ERROR]: chalk.red('[ERROR]'),
    }[level]
    const out = `${chalk.gray(ts)} ${tag} ${message}`
    if (level === LogLevel.ERROR) console.error(out)
    else console.log(out)
}

function readPatchNotes(): string {
    const patchPath = path.resolve(__dirname, '../PATCHNOTES.md')
    if (!fs.existsSync(patchPath)) {
        log(LogLevel.WARN, `PATCHNOTES.md not found at ${patchPath}`)
        return ''
    }
    return fs.readFileSync(patchPath, 'utf-8')
}

type PatchSection = { title: string; body: string }

function readPatchNotesSections(): PatchSection[] {
    const patchPath = path.resolve(__dirname, '../PATCHNOTES.md')
    if (!fs.existsSync(patchPath)) {
        log(LogLevel.WARN, `PATCHNOTES.md not found at ${patchPath}`)
        return []
    }
    const content = fs.readFileSync(patchPath, 'utf-8')
    const matches = Array.from(content.matchAll(/^(#{2,3})\s+(.+)$/gm))
    if (matches.length === 0) return []

    const sections: PatchSection[] = []
    for (let i = 0; i < matches.length; i += 1) {
        const match = matches[i]
        const nextMatch = matches[i + 1]
        const title = match[2].trim().replace(/:+$/, '')
        let bodyStart = (match.index ?? 0) + match[0].length
        if (content[bodyStart] === '\r' && content[bodyStart + 1] === '\n') bodyStart += 2
        else if (content[bodyStart] === '\n') bodyStart += 1
        const bodyEnd = nextMatch?.index ?? content.length
        const body = content.slice(bodyStart, bodyEnd).trim()
        sections.push({ title, body })
    }
    return sections
}

function readPkgVersion(): string {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(pkgRaw) as { version: string }
    return pkg.version
}

function looksLikeCloudflareChallenge(htmlOrText: string): boolean {
    const s = (htmlOrText || '').toLowerCase()
    return (
        s.includes('just a moment') ||
        s.includes('challenge-platform') ||
        s.includes('_cf_chl_opt') ||
        s.includes('cf-ray') ||
        s.includes('enable javascript and cookies') ||
        s.includes('challenge-error-text')
    )
}

function safeSnippet(text: string, maxLen = 900): string {
    const t = (text || '').trim()
    if (!t) return ''
    if (t.length <= maxLen) return t
    return t.slice(0, maxLen) + '…'
}

function buildApiHeaders(version: string, token: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${token}`,
        'User-Agent': `PulseSync-ChangelogPublisher/${version} (github-actions)`,
    }

    const cfAccessId = (process.env.CF_ACCESS_CLIENT_ID || '').trim()
    const cfAccessSecret = (process.env.CF_ACCESS_CLIENT_SECRET || '').trim()
    if (cfAccessId && cfAccessSecret) {
        headers['CF-Access-Client-Id'] = cfAccessId
        headers['CF-Access-Client-Secret'] = cfAccessSecret
    }

    return headers
}

export async function publishChangelogToApi(version?: string): Promise<void> {
    const apiUrl = process.env.CDN_API_URL
    if (!apiUrl) {
        log(LogLevel.ERROR, 'CDN_API_URL is not set in env')
        process.exit(1)
    }
    const token = process.env.CDN_API_TOKEN
    if (!token) {
        log(LogLevel.ERROR, 'CDN_API_TOKEN is not set in env')
        process.exit(1)
    }

    const resolvedVersion = version || readPkgVersion()
    const rawPatch = readPatchNotes()

    try {
        const res = await fetch(`${apiUrl}/cdn/app/changelog`, {
            method: 'POST',
            headers: buildApiHeaders(resolvedVersion, token),
            body: JSON.stringify({ version: resolvedVersion, rawPatch }),
        })

        if (!res.ok) {
            const contentType = (res.headers.get('content-type') || '').toLowerCase()
            const text = await res.text().catch(() => '')

            log(LogLevel.ERROR, `Failed to send changelog: ${res.status} ${res.statusText}`)

            const isHtml = contentType.includes('text/html') || looksLikeCloudflareChallenge(text)
            if (isHtml) {
                log(LogLevel.ERROR, "Cloudflare challenge detected. Make sure CF Access headers are set correctly in environment variables.")
            }

            if (text) console.error(safeSnippet(text))
            process.exit(1)
        }

        log(LogLevel.SUCCESS, `Changelog sent successfully (version: ${resolvedVersion})`)
    } catch (err: any) {
        log(LogLevel.ERROR, `Error sending changelog: ${err?.message || err}`)
        process.exit(1)
    }
}

function parseHexColorToInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback
    const v = value.trim()
    const cleaned = v.startsWith('#') ? v.slice(1) : v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return fallback
    return parseInt(cleaned, 16)
}

function formatDiscordListBlock(block: string, maxLength = 1500): string {
    if (!block.trim()) return '—'

    const bulletByLevel = ['•', '◦', '▪', '▫']
    const indentUnit = '\u00A0\u00A0'

    const rawLines = block.split(/\r?\n/).map(l => l.replace(/\t/g, '    '))
    const outLines: string[] = []

    let lastLevel = 0
    for (const raw of rawLines) {
        if (!raw.trim()) continue

        const m = raw.match(/^(\s*)([-*+]|(\d+\.))\s+(.*)$/)
        if (m) {
            const indent = (m[1] ?? '').length
            const level = Math.max(0, Math.floor(indent / 2))
            lastLevel = level

            const text = (m[4] ?? '').trim()
            const bullet = bulletByLevel[Math.min(level, bulletByLevel.length - 1)]
            const prefix = indentUnit.repeat(level)
            outLines.push(`${prefix}${bullet} ${text || '—'}`)
            continue
        }

        const level = Math.max(0, lastLevel)
        const bullet = bulletByLevel[Math.min(level, bulletByLevel.length - 1)]
        const prefix = indentUnit.repeat(level)
        const text = raw.trim()
        outLines.push(`${prefix}${bullet} ${text}`)
    }

    let result = ''
    for (const line of outLines) {
        const next = result ? result + '\n' + line : line
        if (next.length > maxLength) break
        result = next
    }

    return result || '—'
}

const DISCORD_MESSAGE_FLAG_IS_COMPONENTS_V2 = 1 << 15

type UnfurledMediaItem = { url: string }
type TextDisplay = { type: 10; content: string }
type Separator = { type: 14; divider?: boolean; spacing?: 1 | 2 }
type Button = { type: 2; style: 5; label: string; url: string; disabled?: boolean }
type ActionRow = { type: 1; components: Button[] }
type MediaGalleryItem = { media: UnfurledMediaItem; description?: string | null; spoiler?: boolean }
type MediaGallery = { type: 12; items: MediaGalleryItem[] }
type Container = { type: 17; components: AnyComponent[]; accent_color?: number; spoiler?: boolean }
type AnyComponent = TextDisplay | Separator | Button | ActionRow | MediaGallery | Container

function td(content: string): TextDisplay {
    return { type: 10, content }
}
function sep(spacing: 1 | 2 = 1, divider = false): Separator {
    return { type: 14, spacing, divider }
}

function buildLinkButtons(): ActionRow | null {
    const primaryUrl = (process.env.DISCORD_PRIMARY_URL || '').trim()
    const changelogUrl = (process.env.DISCORD_CHANGELOG_URL || '').trim()

    const buttons: Button[] = []
    if (primaryUrl) buttons.push({ type: 2, style: 5, label: 'Открыть', url: primaryUrl })
    if (changelogUrl) buttons.push({ type: 2, style: 5, label: 'Patch notes', url: changelogUrl })

    if (buttons.length === 0) return null
    return { type: 1, components: buttons.slice(0, 5) }
}

function buildHeaderContainer(version: string, part?: { index: number; total: number }): Container {
    const accent = parseHexColorToInt(process.env.DISCORD_ACCENT_COLOR, 0x6f42c1)
    const bannerUrl = (process.env.DISCORD_BANNER_URL || '').trim()

    const titleLine = '# PulseSync'
    const metaLine = part
        ? `## Вышла новая версия - **${version || '—'}** · Часть ${part.index}/${part.total}`
        : `## Вышла новая версия - **${version || '—'}**`

    const row = buildLinkButtons()

    const inner: AnyComponent[] = [td(`${titleLine}\n${metaLine}`)]

    if (bannerUrl) {
        inner.push(sep(1, false), {
            type: 12,
            items: [
                {
                    media: { url: bannerUrl },
                    description: 'PulseSync release banner',
                },
            ],
        })
    }

    if (row) {
        inner.push(sep(1, false), row)
    }

    return {
        type: 17,
        accent_color: accent,
        components: inner,
    }
}

function inferAccentFromTitle(title: string, fallback: number): number {
    const t = title.toLowerCase()

    if (t.includes('fix') || t.includes('исправ') || t.includes('bug') || t.includes('ошиб')) return 0x2f81f7
    if (t.includes('new') || t.includes('нов') || t.includes('add') || t.includes('добав')) return 0x3fb950
    if (t.includes('change') || t.includes('измен') || t.includes('update') || t.includes('обнов')) return 0xd29922
    if (t.includes('break') || t.includes('важ') || t.includes('critical') || t.includes('hotfix')) return 0xf85149

    return fallback
}

function buildSectionContainer(section: PatchSection): Container {
    const baseAccent = parseHexColorToInt(process.env.DISCORD_ACCENT_COLOR, 0x6f42c1)
    const accent = inferAccentFromTitle(section.title || '', baseAccent)

    const title = (section.title || '—').trim()
    const body = formatDiscordListBlock(section.body, 1700)

    return {
        type: 17,
        accent_color: accent,
        components: [td(`### ${title}`), sep(1, true), td(body)],
    }
}

function countTextLen(c: AnyComponent): number {
    if (c.type === 10) return c.content.length
    if (c.type === 12) return (c.items || []).reduce((s, it) => s + (it.description ? it.description.length : 0), 0)
    if (c.type === 1) return 0
    if (c.type === 17) return c.components.reduce((s, x) => s + countTextLen(x as any), 0)
    return 0
}

function countComponentsDeep(c: AnyComponent): number {
    if (c.type === 17) return 1 + c.components.reduce((s, x) => s + countComponentsDeep(x as any), 0)
    if (c.type === 1) return 1 + c.components.reduce((s, x) => s + countComponentsDeep(x as any), 0)
    if (c.type === 12) return 1 + (c.items?.length || 0)
    return 1
}

type V2Message = { components: AnyComponent[] }

const V2_MAX_TOTAL_COMPONENTS = 40
const V2_MAX_TEXT = 4000
const V2_MAX_TOP_LEVEL = 10

function chunkV2Messages(version: string, sectionContainers: Container[]): V2Message[] {
    const chunks: Container[][] = []
    let cur: Container[] = []

    const baseHeader = buildHeaderContainer(version)
    let curTop = 1
    let curTotal = countComponentsDeep(baseHeader)
    let curText = countTextLen(baseHeader)

    const canAdd = (container: Container) => {
        const nextTop = curTop + 1
        const nextTotal = curTotal + countComponentsDeep(container)
        const nextText = curText + countTextLen(container)
        return nextTop <= V2_MAX_TOP_LEVEL && nextTotal <= V2_MAX_TOTAL_COMPONENTS && nextText <= V2_MAX_TEXT
    }

    for (const c of sectionContainers) {
        if (!canAdd(c)) {
            chunks.push(cur)
            cur = []
            curTop = 1
            curTotal = countComponentsDeep(baseHeader)
            curText = countTextLen(baseHeader)
        }
        cur.push(c)
        curTop += 1
        curTotal += countComponentsDeep(c)
        curText += countTextLen(c)
    }
    chunks.push(cur)

    const total = chunks.length
    const messages: V2Message[] = []
    for (let i = 0; i < chunks.length; i += 1) {
        const header = buildHeaderContainer(version, total > 1 ? { index: i + 1, total } : undefined)
        messages.push({ components: [header, ...chunks[i]] })
    }
    return messages
}

async function discordApiRequest(method: string, url: string, botToken: string, body?: any) {
    const res = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bot ${botToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text().catch(() => '')
    let json: any = null
    if (text) {
        try {
            json = JSON.parse(text)
        } catch {
            json = null
        }
    }
    return { res, text, json }
}

export async function publishPatchNotesToDiscord(): Promise<void> {
    const botToken = process.env.DISCORD_BOT_TOKEN
    const channelId = process.env.DISCORD_CHANNEL_ID

    if (!botToken) {
        log(LogLevel.ERROR, 'DISCORD_BOT_TOKEN is not set in env')
        process.exit(1)
    }
    if (!channelId) {
        log(LogLevel.ERROR, 'DISCORD_CHANNEL_ID is not set in env')
        process.exit(1)
    }

    const sections = readPatchNotesSections()
    const version = readPkgVersion()

    const sectionContainers = sections.map(buildSectionContainer)
    const messages = chunkV2Messages(version, sectionContainers)

    const url = `https://discord.com/api/v10/channels/${channelId}/messages`

    try {
        for (let i = 0; i < messages.length; i += 1) {
            const payload = {
                flags: DISCORD_MESSAGE_FLAG_IS_COMPONENTS_V2,
                components: messages[i].components,
                allowed_mentions: { parse: [] as string[] },
            }

            const r = await discordApiRequest('POST', url, botToken, payload)
            if (!r.res.ok) {
                log(LogLevel.ERROR, `Failed to send patchnotes part ${i + 1}/${messages.length}: ${r.res.status} ${r.res.statusText}`)
                if (r.text) console.error(r.text)
                process.exit(1)
            }
        }

        if (messages.length === 1) log(LogLevel.SUCCESS, 'Patchnotes sent successfully to Discord (components v2)')
        else log(LogLevel.SUCCESS, `Patchnotes sent successfully to Discord (${messages.length} messages, components v2)`)
    } catch (err: any) {
        log(LogLevel.ERROR, `Error sending patchnotes: ${err?.message || err}`)
        process.exit(1)
    }
}

function arg(flag: string): string | null {
    const i = process.argv.indexOf(flag)
    if (i === -1) return null
    return process.argv[i + 1] || null
}
function has(flag: string): boolean {
    return process.argv.includes(flag)
}

async function cli() {
    const doApi = has('--api')
    const doDiscord = has('--discord')
    const version = arg('--version') || undefined

    if (!doApi && !doDiscord) {
        await publishChangelogToApi(version)
        await publishPatchNotesToDiscord()
        return
    }
    if (doApi) {
        await publishChangelogToApi(version)
    }
    if (doDiscord) {
        await publishPatchNotesToDiscord()
    }
}

if (require.main === module) {
    cli().catch(err => {
        log(LogLevel.ERROR, `Unexpected error: ${err?.message || err}`)
        process.exit(1)
    })
}
