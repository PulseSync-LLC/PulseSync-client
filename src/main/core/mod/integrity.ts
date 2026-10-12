import * as fs from 'original-fs'

import { isDeveloperAccount } from '../auth/developerAccess'
import { getState } from '../state'
import { resolveBasePaths } from './mod-files'
import { hashArtifactInWorker } from './network/artifactWorkerClient'

const State = getState()
const SHA256_PATTERN = /^[a-f0-9]{64}$/i
let cachedChecksum: { fingerprint: string; checksum: string } | null = null
let pendingVerification: { epoch: number; promise: Promise<ModIntegrityResult> } | null = null
let pendingRefresh: { epoch: number; promise: Promise<Record<string, unknown>> } | null = null
let installedModMutationCount = 0
let installedModMutationEpoch = 0

export type ModIntegrityResult =
    | { ok: true }
    | { ok: false; reason: 'mod-not-installed' | 'checksum-missing' | 'checksum-mismatch' | 'asar-unavailable' | 'asar-changed' }

export function normalizeAsarChecksum(value: unknown): string | null {
    return typeof value === 'string' && SHA256_PATTERN.test(value.trim()) ? value.trim().toLowerCase() : null
}

function invalidateInstalledModVerification(): void {
    installedModMutationEpoch += 1
    cachedChecksum = null
    pendingVerification = null
    pendingRefresh = null
}

export function beginInstalledModMutation(): () => void {
    installedModMutationCount += 1
    invalidateInstalledModVerification()
    let finished = false
    return () => {
        if (finished) return
        finished = true
        installedModMutationCount -= 1
        invalidateInstalledModVerification()
    }
}

function isCurrentInstalledModEpoch(epoch: number): boolean {
    return installedModMutationCount === 0 && installedModMutationEpoch === epoch
}

function getInstalledModSnapshot(): Record<string, unknown> {
    const mod = State.get('mod')
    return mod && typeof mod === 'object' && !Array.isArray(mod) ? structuredClone(mod) : {}
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

async function verifyInstalledAsar(epoch: number): Promise<ModIntegrityResult> {
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
        }
        if (
            !isCurrentInstalledModEpoch(epoch) ||
            State.get('mod.installed') !== true ||
            normalizeAsarChecksum(State.get('mod.checksum')) !== expectedChecksum ||
            State.get('settings.modSavePath') !== savePath
        ) {
            return { ok: false, reason: 'asar-changed' }
        }
        cachedChecksum = { fingerprint, checksum: actualChecksum }
        return actualChecksum === expectedChecksum ? { ok: true } : { ok: false, reason: 'checksum-mismatch' }
    } catch {
        if (!isCurrentInstalledModEpoch(epoch)) return { ok: false, reason: 'asar-changed' }
        cachedChecksum = null
        return { ok: false, reason: 'asar-unavailable' }
    }
}

export async function verifyInstalledModIntegrity(): Promise<ModIntegrityResult> {
    if (installedModMutationCount > 0) return { ok: false, reason: 'asar-changed' }
    if (pendingVerification?.epoch !== installedModMutationEpoch) {
        pendingVerification = { epoch: installedModMutationEpoch, promise: verifyInstalledAsar(installedModMutationEpoch) }
    }
    const pending = pendingVerification
    try {
        return await pending.promise
    } finally {
        if (pendingVerification === pending) pendingVerification = null
    }
}

async function refreshInstalledMod(epoch: number): Promise<Record<string, unknown>> {
    const snapshot = getInstalledModSnapshot()
    if (!snapshot.installed && !snapshot.version) return snapshot
    const serializedMod = JSON.stringify(snapshot)
    const savePath = State.get('settings.modSavePath')

    try {
        const paths = await resolveBasePaths()
        let fingerprint: string | null = null
        let missingPath: string | null = null
        try {
            fingerprint = await getFileFingerprint(paths.modAsar)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            missingPath = paths.modAsar
        }

        if (!missingPath) {
            if (normalizeAsarChecksum(snapshot.checksum)) {
                if (await isDeveloperAccount()) return getInstalledModSnapshot()
                const result = await verifyInstalledModIntegrity()
                if (result.ok || result.reason !== 'checksum-mismatch') return getInstalledModSnapshot()
            } else {
                try {
                    await fs.promises.stat(paths.backupAsar)
                    return getInstalledModSnapshot()
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
                    missingPath = paths.backupAsar
                }
            }
        }

        const currentPaths = await resolveBasePaths()
        if (currentPaths.modAsar !== paths.modAsar || currentPaths.backupAsar !== paths.backupAsar) return getInstalledModSnapshot()
        if (missingPath) {
            try {
                await fs.promises.stat(missingPath)
                return getInstalledModSnapshot()
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
        }
        if (fingerprint && fingerprint !== (await getFileFingerprint(paths.modAsar))) return getInstalledModSnapshot()
        if (
            isCurrentInstalledModEpoch(epoch) &&
            State.get('settings.modSavePath') === savePath &&
            JSON.stringify(getInstalledModSnapshot()) === serializedMod
        ) {
            State.delete('mod')
            invalidateInstalledModVerification()
        }
    } catch {
        return getInstalledModSnapshot()
    }
    return getInstalledModSnapshot()
}

export async function refreshInstalledModState(): Promise<Record<string, unknown>> {
    if (installedModMutationCount > 0) return getInstalledModSnapshot()
    if (pendingRefresh?.epoch !== installedModMutationEpoch) {
        pendingRefresh = { epoch: installedModMutationEpoch, promise: refreshInstalledMod(installedModMutationEpoch) }
    }
    const pending = pendingRefresh
    try {
        return await pending.promise
    } finally {
        if (pendingRefresh === pending) pendingRefresh = null
    }
}
