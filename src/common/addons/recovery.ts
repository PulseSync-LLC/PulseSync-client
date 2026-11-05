export type AddonRecoveryEntry = {
    runtime: 'legacy' | 'webhost'
    id: string
    directoryName: string
    fingerprint: string
    name: string
    reason: string
    details: string
    failedAt: number
    status: 'quarantined' | 'retrying'
}

export type DesktopAddonRecoveryEntry = AddonRecoveryEntry & {
    sourceId: string
    connected: boolean
}

export type DesktopAddonRecoverySnapshot = {
    connection: 'connected' | 'disconnected' | 'unsupported' | 'loading'
    entries: DesktopAddonRecoveryEntry[]
}

export type DesktopAddonRecoveryRequest = Pick<DesktopAddonRecoveryEntry, 'sourceId' | 'runtime' | 'id' | 'fingerprint'>
