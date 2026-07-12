import type { DesktopRuntimeVersions } from './version'

export interface ActiveRuntimeV3 extends DesktopRuntimeVersions {
    schemaVersion: 3
    generation: number
    bundleVersion: string
    metadataVersion: number
    hostPath: string
    corePath: string
    coreEntry: string
    corePreload: string
    activationState: 'pending' | 'confirmed'
    components: Record<string, { version: string; path: string; sha256: string; required: boolean }>
    optionalFailures: Array<{ key: string; reason: string }>
}

export interface RuntimeAcknowledgementV3 {
    schemaVersion: 3
    state: 'confirmed'
    generation: number
}
