const key = (directoryName: string) => `pulsesync.addons.metadataTarget:${encodeURIComponent(directoryName)}`

export function prefersInstalledMetadata(directoryName: string): boolean {
    try {
        return window.localStorage.getItem(key(directoryName)) === 'installed'
    } catch {
        return false
    }
}

export function rememberInstalledMetadata(directoryName: string): void {
    try {
        window.localStorage.setItem(key(directoryName), 'installed')
    } catch {}
}

export function resetMetadataPreference(directoryName: string): void {
    try {
        window.localStorage.removeItem(key(directoryName))
    } catch {}
}
