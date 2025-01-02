export interface Settings {
    autoStartInTray: boolean
    autoStartMusic: boolean
    autoStartApp: boolean
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
    enableRpcButtonListen: boolean
    details: string
    state: string
    button: string
    enableGithubButton: boolean
}

export default interface SettingsInterface {
    settings: Settings
    discordRpc: discordRpc
    tokens: Tokens
    mod: Mod
    info: Info
}
