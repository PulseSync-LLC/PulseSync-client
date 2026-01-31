export enum DiscordState {
    CLOSED = 'closed',
    ADMINISTRATOR = 'administrator',
    SNAP = 'snap',
    FLATPAK = 'flatpak',
    SUCCESS = 'success',
}

export type AppConfig = {
    CLIENT_ID: string
    RESERVE_CLIENT_ID?: string
}
