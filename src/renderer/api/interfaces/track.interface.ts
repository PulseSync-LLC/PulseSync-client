export interface DownloadInfo {
    trackId: string
    quality: string
    codec: string
    bitrate: number
    transport: string
    key: string
    size: number
    gain: boolean
    urls: string[]
    url: string
    realId: string
}
export interface Progress {
    duration: number
    loaded: number
    position: number
    played: number
}
interface CurrentDevice {
    info: {
        device_id: string
        title: string
        type: string
        app_name: string
        app_version: string
    }
    volume: number
    capabilities: {
        can_be_player: boolean
        can_be_remote_controller: boolean
        volume_granularity: number
    }
    session: {
        id: string
    }
    is_offline: boolean
    volume_info: {
        volume: number
        version: {
            device_id: string
            version: string
            timestamp_ms: string
        }
    }
}
export interface Track {
    currentDevice: CurrentDevice
    sourceType: string
    event: string
    progress: Progress
    ynisonProgress: number
    queue: any[]
    currentMs: number
    repeat: string
    shuffle: boolean
    speed: number
    volume: number
    status: string
    url: string
    linkTitle: string
    albumArt: string
    timestamps: number[]
    realId: string
    imageUrl: string
    id: string
    title: string
    major: {
        id: number
        name: string
    }
    available: boolean
    availableForPremiumUsers: boolean
    availableFullWithoutPermission: boolean
    availableForOptions: string[]
    disclaimers: any[]
    storageDir: string
    durationMs: number
    fileSize: number
    r128: {
        i: number
        tp: number
    }
    artists: Artist[]
    albums: Album[]
    coverUri: string
    ogImage: string
    lyricsAvailable: boolean
    type: string
    rememberPosition: boolean
    trackSharingFlag: string
    lyricsInfo: {
        hasAvailableSyncLyrics: boolean
        hasAvailableTextLyrics: boolean
    }
    trackSource: string
    specialAudioResources: string[]
    liked: boolean
    downloadInfo: DownloadInfo
}

export interface Artist {
    id: number
    name: string
    various: boolean
    composer: boolean
    available: boolean
    cover: {
        type: string
        uri: string
        prefix: string
    }
    genres: any[]
    disclaimers: any[]
}

export interface Album {
    id: number
    title: string
    type: string
    metaType: string
    year: number
    releaseDate: string
    coverUri: string
    ogImage: string
    genre: string
    trackCount: number
    likesCount: number
    recent: boolean
    veryImportant: boolean
    artists: Artist[]
    labels: Label[]
    available: boolean
    availableForPremiumUsers: boolean
    availableForOptions: string[]
    availableForMobile: boolean
    availablePartially: boolean
    bests: any[]
    disclaimers: any[]
    listeningFinished: boolean
    trackPosition: {
        volume: number
        index: number
    }
}

export interface Label {
    id: number
    name: string
}
