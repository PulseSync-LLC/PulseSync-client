export interface Settings {
    readPolicy: boolean
    autoStartInTray: boolean
    autoStartMusic: boolean
    autoStartApp: boolean
}
export interface Info {
    version: string
}
export interface Patcher {
    version: string
    changelog: string[]
    patched: boolean
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
    patcher: Patcher
    info: Info
}
