export interface ModInterface {
    id: number
    modVersion: string
    musicVersion: string
    name: string
    checksum: string
    downloadUrl: string
    showModal: string
    createdAt: string
    changelog: string
    shouldReinstall: boolean
    spoof: boolean
    deprecated: boolean
}
