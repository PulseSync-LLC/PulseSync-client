export interface Progress {
    duration: number;
    loaded: number;
    position: number;
    played: number;
}
export interface Track {
    event: string;
    progress: Progress;
    queue: any[];
    currentMs: number;
    repeat: string;
    shuffle: boolean;
    speed: number;
    volume: number;
    status: string;
    url: string
    linkTitle: string;
    albumArt: string;
    timestamps: number[];
    realId: string;
    title: string;
    major: {
        id: number;
        name: string;
    };
    available: boolean;
    availableForPremiumUsers: boolean;
    availableFullWithoutPermission: boolean;
    availableForOptions: string[];
    disclaimers: any[];
    storageDir: string;
    durationMs: number;
    fileSize: number;
    r128: {
        i: number;
        tp: number;
    };
    artists: Artist[];
    albums: Album[];
    coverUri: string;
    ogImage: string;
    lyricsAvailable: boolean;
    type: string;
    rememberPosition: boolean;
    trackSharingFlag: string;
    lyricsInfo: {
        hasAvailableSyncLyrics: boolean;
        hasAvailableTextLyrics: boolean;
    };
    trackSource: string;
    specialAudioResources: string[];
    liked: boolean;
}

export interface Artist {
    id: number;
    name: string;
    various: boolean;
    composer: boolean;
    available: boolean;
    cover: {
        type: string;
        uri: string;
        prefix: string;
    };
    genres: any[];
    disclaimers: any[];
}

export interface Album {
    id: number;
    title: string;
    type: string;
    metaType: string;
    year: number;
    releaseDate: string;
    coverUri: string;
    ogImage: string;
    genre: string;
    trackCount: number;
    likesCount: number;
    recent: boolean;
    veryImportant: boolean;
    artists: Artist[];
    labels: Label[];
    available: boolean;
    availableForPremiumUsers: boolean;
    availableForOptions: string[];
    availableForMobile: boolean;
    availablePartially: boolean;
    bests: any[];
    disclaimers: any[];
    listeningFinished: boolean;
    trackPosition: {
        volume: number;
        index: number;
    };
}

export interface Label {
    id: number;
    name: string;
}
