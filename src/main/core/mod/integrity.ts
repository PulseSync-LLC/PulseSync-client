import * as fs from 'original-fs'

import { getState } from '../state'
import { resolveBasePaths } from './mod-files'
import { hashArtifactInWorker } from './network/artifactWorkerClient'

const State = getState()
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
let cachedChecksum: { fingerprint: string; checksum: string } | null = null
let pendingVerification: Promise<ModIntegrityResult> | null = null

export type ModIntegrityResult =
    | { ok: true }
    | { ok: false; reason: 'mod-not-installed' | 'checksum-missing' | 'checksum-mismatch' | 'asar-unavailable' | 'asar-changed' }

export function normalizeAsarChecksum(value: unknown): string | null {
    return typeof value === 'string' && SHA256_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : null
}

async function getFileFingerprint(filePath: string): Promise<string> {
    const stats = await fs.promises.stat(filePath)
    if (!stats.isFile()) throw new Error('ASAR is not a file')
    return JSON.stringify([filePath, stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs, stats.birthtimeMs])
}

export async function readInstalledAsarChecksum(filePath: string): Promise<string> {
    const before = await getFileFingerprint(filePath)
    const { checksum } = await hashArtifactInWorker({ filePath })
    const normalized = normalizeAsarChecksum(checksum)
    if (!normalized || before !== (await getFileFingerprint(filePath))) throw new Error('Unable to verify installed ASAR checksum')
    return normalized
}

async function verifyInstalledAsar(): Promise<ModIntegrityResult> {
    if (State.get('mod.installed') !== true) return { ok: false, reason: 'mod-not-installed' }
    const expectedChecksum = normalizeAsarChecksum(State.get('mod.checksum'))
    if (!expectedChecksum) return { ok: false, reason: 'checksum-missing' }
    const savePath = State.get('settings.modSavePath')

    try {
        const { modAsar } = await resolveBasePaths()
        const fingerprint = await getFileFingerprint(modAsar)
        let actualChecksum = cachedChecksum?.fingerprint === fingerprint ? cachedChecksum.checksum : null
        if (!actualChecksum) {
            actualChecksum = await readInstalledAsarChecksum(modAsar)
            if (fingerprint !== (await getFileFingerprint(modAsar))) return { ok: false, reason: 'asar-changed' }
            cachedChecksum = { fingerprint, checksum: actualChecksum }
        }
        if (
            State.get('mod.installed') !== true ||
            normalizeAsarChecksum(State.get('mod.checksum')) !== expectedChecksum ||
            State.get('settings.modSavePath') !== savePath
        ) {
            return { ok: false, reason: 'asar-changed' }
        }
        return actualChecksum === expectedChecksum ? { ok: true } : { ok: false, reason: 'checksum-mismatch' }
    } catch {
        cachedChecksum = null
        return { ok: false, reason: 'asar-unavailable' }
    }
}

export async function verifyInstalledModIntegrity(): Promise<ModIntegrityResult> {
    pendingVerification ??= verifyInstalledAsar()
    const pending = pendingVerification
    try {
        return await pending
    } finally {
        if (pendingVerification === pending) pendingVerification = null
    }
}
