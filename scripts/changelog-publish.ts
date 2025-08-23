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
    const ts = new Date().toISOString()
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

function readPkgVersion(): string {
    const pkgPath = path.resolve(__dirname, '../package.json')
    const pkgRaw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(pkgRaw) as { version: string }
    return pkg.version
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
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ version: resolvedVersion, rawPatch }),
        })
        if (!res.ok) {
            log(LogLevel.ERROR, `Failed to send changelog: ${res.status} ${res.statusText}`)
            const text = await res.text().catch(() => '')
            if (text) console.error(text)
            process.exit(1)
        }
        log(LogLevel.SUCCESS, `Changelog sent successfully (version: ${resolvedVersion})`)
    } catch (err: any) {
        log(LogLevel.ERROR, `Error sending changelog: ${err?.message || err}`)
        process.exit(1)
    }
}

export async function publishPatchNotesToDiscord(): Promise<void> {
    const webhookUrl = process.env.DISCORD_WEBHOOK
    if (!webhookUrl) {
        log(LogLevel.ERROR, 'DISCORD_WEBHOOK is not set in env')
        process.exit(1)
    }
    const rawPatch = readPatchNotes()
    const version = readPkgVersion()

    const embed = {
        title: 'PulseSync',
        description: 'Вышла новая версия приложения!',
        color: 0x5865f2,
        fields: [
            { name: 'Версия:', value: version, inline: true },
            { name: 'Изменения:', value: rawPatch || '—', inline: true },
        ],
        footer: { text: 'https://pulsesync.dev', icon_url: process.env.BOT_AVATAR_URL },
        timestamp: new Date().toISOString(),
    }

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        })
        if (!res.ok) {
            log(LogLevel.ERROR, `Failed to send patchnotes: ${res.status} ${res.statusText}`)
            const text = await res.text().catch(() => '')
            if (text) console.error(text)
            process.exit(1)
        }
        log(LogLevel.SUCCESS, 'Patchnotes sent successfully to Discord')
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
