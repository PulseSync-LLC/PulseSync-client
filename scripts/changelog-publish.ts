import 'dotenv/config'

import { fileURLToPath, pathToFileURL } from 'node:url'

import chalk from 'chalk'
import fs from 'fs'
import path from 'path'

import { fetchWithRetry } from './network-retry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
        const res = await fetchWithRetry(
            `${apiUrl}/cdn/app/changelog`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ version: resolvedVersion, changelog: rawPatch }),
            },
            // The backend upserts this exact version, so replaying the payload cannot create a duplicate changelog.
            { label: 'changelog publication', retryUnsafe: true },
        )
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

function arg(flag: string): string | null {
    const i = process.argv.indexOf(flag)
    if (i === -1) return null
    return process.argv[i + 1] || null
}
function has(flag: string): boolean {
    return process.argv.includes(flag)
}

async function cli() {
    if (has('--discord')) {
        throw new Error('Discord publication is handled by PulseSync-bot after creating a patch note on the website')
    }
    await publishChangelogToApi(arg('--version') || undefined)
}

const isDirectRun = process.argv[1] != null && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isDirectRun) {
    cli().catch(err => {
        log(LogLevel.ERROR, `Unexpected error: ${err?.message || err}`)
        process.exit(1)
    })
}
