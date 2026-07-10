export let updated = false
export let musicPath = ''
export let asarFilename = 'app.backup.asar'
export let asarBackup = ''
export let selectedAddon = 'Default'

export function setUpdated(value: boolean): void {
    updated = value
}

export function setMusicPath(value: string): void {
    musicPath = value
    asarBackup = value ? path.join(value, asarFilename) : ''
}

export function setAsarFilename(value: string): void {
    asarFilename = value
    if (musicPath) {
        asarBackup = path.join(musicPath, value)
    }
}

export function setSelectedAddon(value: string): void {
    selectedAddon = value
}
import path from 'node:path'
