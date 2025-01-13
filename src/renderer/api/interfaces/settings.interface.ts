export interface Settings {
    autoStartInTray: boolean
    autoStartMusic: boolean
    autoStartApp: boolean
    hardwareAcceleration: boolean
    deletePextAfterImport: boolean
    closeAppInTray: boolean
    writeMetadataAfterDownload: boolean
}
export interface Info {
    version: string
}
export interface Mod {
    musicVersion: string
    version: string
    changelog: string[]
    installed: boolean
    updated: boolean
}
export interface Tokens {
    token: string
}
export interface discordRpc {
    appId: string
    status: boolean
    details: string
    state: string
    button: string
    displayPause: boolean
    enableRpcButtonListen: boolean
    enableGithubButton: boolean
}

export default interface SettingsInterface {
    settings: Settings
    discordRpc: discordRpc
    tokens: Tokens
    mod: Mod
    info: Info
}
