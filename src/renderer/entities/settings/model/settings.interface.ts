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
