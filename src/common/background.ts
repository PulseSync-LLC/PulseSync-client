import type { CloudSettingsStatus } from './cloudSettings'
import type { ClientBuildIdentity } from './types/clientBuildIdentity'
import type { ClientHardwareIdentity } from './types/clientHardwareIdentity'

export const BACKGROUND_IPC = {
    start: 'background:start',
    preferences: 'background:preferences',
    send: 'background:send',
    syncCloud: 'background:sync-cloud',
    checkAddons: 'background:check-addons',
    changed: 'background:changed',
} as const

export type GatewayFrame = { e?: string; d?: any }

export type BackgroundConnection = {
    connected: boolean
    revision: number
    failures: number
    userId: string
}

export type BackgroundConfiguration = {
    userId: string
    version: string
    page: string
    buildIdentity: ClientBuildIdentity
    hardwareIdentity: ClientHardwareIdentity | null
}

export type BackgroundPreferences = {
    userId: string
    trackSendingEnabled: boolean
    metricsSendingEnabled: boolean
    listeningEnabled: boolean
    legacyAddonRestrictionsEnabled: boolean
    legacyAddonRestrictionsOverrideGroup?: string
    suspendAllowed: boolean
}

export type BackgroundEvent =
    | { type: 'addons-changed' }
    | { type: 'connection'; connection: BackgroundConnection }
    | { type: 'gateway'; frame: GatewayFrame }
    | { type: 'notice'; tone: 'success' | 'info'; title: string; body: string }

export interface DesktopBackgroundApi {
    start(configuration: BackgroundConfiguration): Promise<BackgroundConnection>
    setPreferences(preferences: BackgroundPreferences): Promise<void>
    send(event: string, payload: unknown): void
    synchronizeCloud(userId: string, enabled?: boolean): Promise<CloudSettingsStatus>
    checkAddonUpdates(): Promise<void>
    onChange(listener: (event: BackgroundEvent) => void): () => void
}
