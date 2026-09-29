import { hashArtifactInWorker } from './artifactWorkerClient'
import { fetchBackendModReleases, type ModReleaseEntry } from './releaseCatalog'

export type RemoteModInfo = Pick<ModReleaseEntry, 'modVersion' | 'musicVersion' | 'realMusicVersion' | 'name' | 'checksum' | 'checksum_v2'>

export type ResolvedInstallModMatch = {
    incomingChecksum: string
    matchedMod: RemoteModInfo | null
}

const fetchRemoteMods = async (): Promise<RemoteModInfo[]> => {
    const releases = await fetchBackendModReleases()
    return releases.map(({ modVersion, musicVersion, realMusicVersion, name, checksum, checksum_v2 }) => ({
        modVersion,
        musicVersion,
        realMusicVersion,
        name,
        checksum,
        checksum_v2,
    }))
}

const findRemoteModByChecksum = async (checksum: string): Promise<RemoteModInfo | null> => {
    const mods = await fetchRemoteMods()
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
    const matchedMod = await findRemoteModByChecksum(incomingChecksum)
    return { incomingChecksum, matchedMod }
}
