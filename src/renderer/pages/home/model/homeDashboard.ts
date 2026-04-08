export type HomePrimaryComponent = {
    id: 'mod' | 'client' | 'music',
    titleKey: string
    iconAsset: string
}

export type HomeSecondaryComponent = {
    id: string
    title: string
}

export const primaryComponents: HomePrimaryComponent[] = [
    {
        id: 'music',
        titleKey: 'pages.home.musicName',
        iconAsset: 'icons/homeYandexMusic.svg',
    },
    {
        id: 'mod',
        titleKey: 'pages.home.modName',
        iconAsset: 'icons/homeMod.svg',
    },
    {
        id: 'client',
        titleKey: 'pages.home.clientName',
        iconAsset: 'icon/App.svg',
    },
]

export const secondaryComponents: HomeSecondaryComponent[] = [
    { id: 'ffmpeg', title: 'ffmpeg' },
    { id: 'yt-dlp', title: 'yt-dlp' },
    { id: 'obs-widget', title: 'OBS Widget' },
]
