export interface Settings {
    saveWindowDimensionsOnRestart: boolean
    saveWindowPositionOnRestart: boolean
    autoStartInTray: boolean
    autoStartMusic: boolean
    autoStartApp: boolean
    hardwareAcceleration: boolean
    deletePextAfterImport: boolean
    closeAppInTray: boolean
    devSocket: boolean
    askSavePath: boolean
    saveAsMp3: boolean
    showModModalAfterInstall: boolean
    language: string
}
export interface Info {
    version: string
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
