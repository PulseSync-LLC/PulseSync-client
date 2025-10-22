export enum DiscordState {
    CLOSED = 'Не удалось обнаружить запущенный Discord!',
    ADMINISTRATOR = 'Похоже, Discord запущен с правами администратора. Запустите PulseSync с правами администратора.',
    SNAP = 'Похоже, Discord запущен из пакета Snap. Это, скорее всего, помешает приложению подключиться к RPC',
    FLATPAK = 'Похоже, Discord запущен из пакета Flatpak. Это, скорее всего, помешает приложению подключится к RPC',
    SUCCESS = '',
}

export type AppConfig = {
    CLIENT_ID: string
    RESERVE_CLIENT_ID?: string
}
