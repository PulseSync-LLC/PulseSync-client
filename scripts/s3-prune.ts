import 'dotenv/config'
import { pruneUnreferencedDesktopArtifacts } from './s3-upload.js'

function argValue(name: string): string | null {
    const index = process.argv.indexOf(name)
    return index === -1 ? null : (process.argv[index + 1] ?? null)
}

function positiveNumber(name: string, fallback: number): number {
    const raw = argValue(name)
    if (raw === null) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
    return value
}

const branch = argValue('--branch') ?? 'dev'
const summary = await pruneUnreferencedDesktopArtifacts(branch, {
    apply: process.argv.includes('--apply'),
    graceHours: positiveNumber('--grace-hours', 24),
    keepReleases: positiveNumber('--keep-releases', 2),
    prefix: argValue('--prefix') ?? undefined,
})

console.log(JSON.stringify(summary, null, 2))
