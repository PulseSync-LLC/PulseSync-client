import { hashArtifactInWorker } from './artifactWorkerClient'
import { fetchBackendModReleases, fetchGithubBranchBuilds, type ModReleaseEntry } from './releaseCatalog'

export type RemoteModInfo = Pick<ModReleaseEntry, 'modVersion' | 'musicVersion' | 'realMusicVersion' | 'name' | 'checksum' | 'checksum_v2'> &
    Partial<Pick<ModReleaseEntry, 'branch' | 'channel' | 'commit' | 'downloadUnpackedUrl' | 'unpackedChecksum'>>

export type ResolvedInstallModMatch = {
    incomingChecksum: string
    matchedMod: RemoteModInfo | null
}

const findRemoteModByChecksum = async (checksum: string, branchBuild: boolean): Promise<RemoteModInfo | null> => {
    const mods = await (branchBuild ? fetchGithubBranchBuilds() : fetchBackendModReleases())
    return (
        mods.find(mod => {
            const checksumV2 = typeof mod.checksum_v2 === 'string' ? mod.checksum_v2.trim().toLowerCase() : ''
            const checksumV1 = typeof mod.checksum === 'string' ? mod.checksum.trim().toLowerCase() : ''
            return checksumV2 === checksum || checksumV1 === checksum
        }) ?? null
    )
}

export const resolveInstallModMatch = async (asarPath: string): Promise<ResolvedInstallModMatch> => {
    const { checksum: incomingChecksum } = await hashArtifactInWorker({ filePath: asarPath })
    const matchedMod = await findRemoteModByChecksum(incomingChecksum, asarPath.toLowerCase().endsWith('.asar.zst'))
    return { incomingChecksum, matchedMod }
}
