export interface ModInterface {
    id: number
    modVersion: string
    musicVersion: string
    realMusicVersion: string
    name: string
    checksum: string
    checksum_v2: string
    downloadUrl: string
    downloadUnpackedUrl: string
    unpackedChecksum: string
    showModal: string
    createdAt: string
    changelog: string
    shouldReinstall: boolean
    spoof: boolean
    deprecated: boolean
}
