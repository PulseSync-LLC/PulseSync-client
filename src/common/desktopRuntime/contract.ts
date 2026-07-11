import type { DesktopRuntimeVersions } from './version'

export interface ActiveRuntimeV2 extends DesktopRuntimeVersions {
    schemaVersion: 2
    generation: number
    hostPath: string
    corePath: string
    coreEntry: string
    corePreload: string
    activationState: 'pending' | 'confirmed'
    components: Record<string, { version: string; path: string; sha256: string }>
}

export interface RuntimeAcknowledgementV2 {
    schemaVersion: 2
    state: 'confirmed'
    generation: number
}
