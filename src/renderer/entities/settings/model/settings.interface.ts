import type { ModReleaseChannel, ModSourceSelection } from '@common/types/modSource'

export interface Settings {
    saveWindowDimensionsOnRestart: boolean
    saveWindowPositionOnRestart: boolean
    autoStartInTray: boolean
    autoStartMusic: boolean
    autoStartApp: boolean
    hardwareAcceleration: boolean
    deletePextAfterImport: boolean
    autoUpdateStoreAddons: boolean
    closeAppInTray: boolean
    devSocket: boolean
    showDevFrame: boolean
    askSavePath: boolean
    saveAsMp3: boolean
    showModModalAfterInstall: boolean
    language: string
    modSavePath?: string
    modSource: ModSourceSelection
}
export interface Info {
    version: string
    branch: string
    devmark: boolean
}
export interface Mod {
    musicVersion: string
    name: string
    version: string
    changelog: string[]
    installed: boolean
    updated: boolean
    showModal: boolean
    sourceType: ModReleaseChannel
    branch: string
    commit: string
}
export interface Tokens {
    token: string
}

export default interface SettingsInterface {
    settings: Settings
    tokens: Tokens
    mod: Mod
    info: Info
}
