import { setTimeout as delay } from 'node:timers/promises'

import { isAxiosError } from 'axios'

import logger from '../../../shared/logger'
import { getUpdateSource } from '../../../shared/updater/updateSource'
import { hashArtifactInWorker } from './artifactWorkerClient'
import { fetchGithubBranchBuilds, getModReleasesForSource, type ModReleaseEntry } from './releaseCatalog'

const MOD_LOOKUP_ATTEMPTS = 3
const MOD_LOOKUP_RETRY_DELAY_MS = 1000
const RETRYABLE_NETWORK_CODES = new Set(['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ERR_NETWORK'])

export type RemoteModInfo = Pick<ModReleaseEntry, 'modVersion' | 'musicVersion' | 'realMusicVersion' | 'name' | 'checksum' | 'checksum_v2'> &
    Partial<Pick<ModReleaseEntry, 'branch' | 'channel' | 'commit' | 'downloadUnpackedUrl' | 'unpackedChecksum'>>

export type ResolvedInstallModMatch = {
    incomingChecksum: string
    matchedMod: RemoteModInfo | null
}

const isRetryableModLookupError = (error: unknown): boolean => {
    if (isAxiosError(error)) {
        const status = error.response?.status
        if (status) return status === 408 || status === 429 || (status >= 500 && status <= 599)
        return RETRYABLE_NETWORK_CODES.has(error.code || '')
    }

    return error instanceof Error && (error.name === 'TimeoutError' || /fetch failed|failed to fetch/iu.test(error.message))
}

const findRemoteModByChecksum = async (checksum: string, branchBuild: boolean): Promise<RemoteModInfo | null> => {
    for (let attempt = 1; ; attempt++) {
        try {
            const mods = await (branchBuild ? fetchGithubBranchBuilds() : getModReleasesForSource(getUpdateSource()))
            return (
                mods.find(mod => {
                    const checksumV2 = typeof mod.checksum_v2 === 'string' ? mod.checksum_v2.trim().toLowerCase() : ''
                    const checksumV1 = typeof mod.checksum === 'string' ? mod.checksum.trim().toLowerCase() : ''
                    return checksumV2 === checksum || checksumV1 === checksum
                }) ?? null
            )
        } catch (error) {
            if (attempt >= MOD_LOOKUP_ATTEMPTS || !isRetryableModLookupError(error)) throw error

            const delayMs = attempt * MOD_LOOKUP_RETRY_DELAY_MS
            logger.modManager.warn('Retrying local mod release lookup', { attempt: attempt + 1, delayMs, error })
            await delay(delayMs)
        }
    }
}

export const resolveInstallModMatch = async (asarPath: string): Promise<ResolvedInstallModMatch> => {
    const { checksum: incomingChecksum } = await hashArtifactInWorker({ filePath: asarPath })
    const matchedMod = await findRemoteModByChecksum(incomingChecksum, asarPath.toLowerCase().endsWith('.asar.zst'))
    return { incomingChecksum, matchedMod }
}
