export interface ModInterface {
    id: number
    modVersion: string
    musicVersion: string
    realMusicVersion: string
    name: string
    checksum: string
    downloadUrl: string
    downloadUnpackedUrl: string
    showModal: string
    createdAt: string
    changelog: string
    shouldReinstall: boolean
    spoof: boolean
    deprecated: boolean
}
