export type HomePrimaryComponent = {
    id: 'mod' | 'client' | 'music',
    titleKey: string
    iconAsset: string
}

export type HomeSecondaryComponent = {
    id: string
    title: string
    iconAsset: string
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
        iconAsset: 'icons/homeClient.svg',
    },
]

export const secondaryComponents: HomeSecondaryComponent[] = [
    { id: 'ffmpeg', title: 'FFmpeg', iconAsset: 'icons/homeFfmpeg.svg' },
    { id: 'yt-dlp', title: 'YT Dlp', iconAsset: 'icons/homeYtdlp.svg' },
    { id: 'obs-widget', title: 'OBS Widget', iconAsset: 'icons/homeObs.svg' },
]
