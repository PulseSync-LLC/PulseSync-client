export enum DiscordState {
    CLOSED = 'closed',
    ADMINISTRATOR = 'administrator',
    SNAP = 'snap',
    FLATPAK = 'flatpak',
    SUCCESS = 'success',
}

export type AppConfig = {
    ENG_CLIENT_ID?: string
    RU_CLIENT_ID?: string
    CLIENT_ID?: string
    RESERVE_CLIENT_ID?: string
}
