export interface Track {
    currentDevice?: CurrentDevice
    downloadInfo?: DownloadInfo
    isPlaying?: boolean
    albumArt?: string
    canMoveBackward?: boolean
    canMoveForward?: boolean
    status?: string
    sourceType?: string
    ynisonProgress?: number
    progress?: Progress
    availableActions?: AvailableActions
    actionsStore?: ActionsStore

    id: string
    realId: string
    title: string
    contentWarning?: string
    major: {
        id: number
        name: string
    }
    version?: string

    available: boolean
    availableForPremiumUsers: boolean
    availableFullWithoutPermission: boolean
    availableForOptions: string[]
    disclaimers: string[]
    storageDir: string
    durationMs: number
    fileSize: number

    r128: R128
    fade: Fade

    previewDurationMs: number
    artists: Artist[]
    albums: Album[]

    coverUri: string
    derivedColors: DerivedColors
    ogImage: string

    url?: string
    lyricsAvailable: boolean
    type: string
    rememberPosition: boolean
    trackSharingFlag: string
    lyricsInfo: LyricsInfo
    trackSource: string
    specialAudioResources: string[]
}

export interface R128 {
    i: number
    tp: number
}

export interface Fade {
    inStart: number
    inStop: number
    outStart: number
    outStop: number
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
    genres: string[]
    disclaimers: string[]
}

export interface Album {
    id: number
    title: string
    type?: string
    metaType: string
    version?: string
    contentWarning?: string
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
    disclaimers: string[]
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

export interface DerivedColors {
    average: string
    waveText: string
    miniPlayer: string
    accent: string
}

export interface LyricsInfo {
    hasAvailableSyncLyrics: boolean
    hasAvailableTextLyrics: boolean
}

export interface Progress {
    duration: number
    loaded: number
    position: number
    played?: number
}

export interface AvailableActions {
    moveBackward: boolean
    moveForward: boolean
    repeat: boolean
    shuffle: boolean
    speed: boolean
}

export interface ActionsStore {
    repeat: string
    shuffle: boolean
    isLiked: boolean
    isDisliked: boolean
}

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

export interface CurrentDevice {
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
