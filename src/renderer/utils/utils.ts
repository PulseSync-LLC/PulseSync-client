import toast from '../components/toast'
import config from '@common/appConfig'
import { Track } from '../api/interfaces/track.interface'
import trackInitials from '../api/initials/track.initials'
import { t } from '../i18n'

export const checkInternetAccess = async (): Promise<boolean> => {
    try {
        const response = await fetch(`${config.SERVER_URL}`, {
            method: 'GET',
            cache: 'no-store',
        })
        return response.ok
    } catch (error) {
        console.error(t('utils.internetCheckError'), error)
        return false
    }
}

export const notifyUserRetries = (retriesLeft: number) => {
    const retryIntervalInSeconds = Number(config.RETRY_INTERVAL_MS) / 1000
    toast.custom('success', t('utils.connectionAttemptTitle'), t('utils.connectionAttemptMessage', { retriesLeft, retryIntervalInSeconds }), {
        icon: '🔄',
        duration: 10000,
    })
}

export const compareVersions = (v1: string, v2: string) => {
    const v1parts = v1.split('.').map(Number)
    const v2parts = v2.split('.').map(Number)
    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
        const a = v1parts[i] || 0
        const b = v2parts[i] || 0
        if (a > b) return 1
        if (a < b) return -1
    }
    return 0
}

export const timeAgo = (timestamp: number) => {
    const now = Date.now()
    let diff = now - timestamp
    if (diff < 0) diff = 0
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const weeks = Math.floor(days / 7)
    const months = Math.floor(days / 30)
    const years = Math.floor(days / 365)
    if (seconds < 60) {
        return t('utils.timeAgo.seconds', { count: seconds })
    } else if (minutes < 60) {
        return t('utils.timeAgo.minutes', { count: minutes })
    } else if (hours < 24) {
        return t('utils.timeAgo.hours', { count: hours })
    } else if (days < 7) {
        return t('utils.timeAgo.days', { count: days })
    } else if (days < 30) {
        return t('utils.timeAgo.weeks', { count: weeks })
    } else if (days < 365) {
        return t('utils.timeAgo.months', { count: months })
    } else {
        return t('utils.timeAgo.years', { count: years })
    }
}

export const errorTypesToShow = new Set([
    'version_too_new',
    'version_outdated',
    'checksum_mismatch',
    'mod_filename_missing',
    'compatibility_check_error',
    'file_not_found',
    'file_copy_error',
    'unexpected_error',
    'download_error',
    'writer_error',
    'finish_error',
    'download_outer_error',
    'backup_not_found',
    'remove_mod_error',
    'linux_permissions_required',
])

export function getCoverImage(t: Track): string {
    return t.albumArt || 'https://cdn.discordapp.com/app-assets/984031241357647892/1180527644668862574.png'
}

export function mapArtists(artists: any[] | undefined) {
    if (!Array.isArray(artists)) return []
    return artists.map(a => ({
        id: a?.id ?? 0,
        name: a?.name ?? '',
        various: a?.various ?? false,
        composer: a?.composer ?? false,
        available: a?.available ?? false,
        cover: {
            type: a?.cover?.type ?? '',
            uri: a?.cover?.uri ?? '',
            prefix: a?.cover?.prefix ?? '',
        },
        genres: a?.genres ?? [],
        disclaimers: a?.disclaimers ?? [],
    }))
}

export function mapAlbums(albums: any[] | undefined) {
    if (!Array.isArray(albums)) return []
    return albums.map(album => ({
        id: album?.id ?? 0,
        title: album?.title ?? '',
        metaType: album?.metaType ?? '',
        version: album?.version ?? '',
        year: album?.year ?? 0,
        releaseDate: album?.releaseDate ?? '',
        coverUri: album?.coverUri ?? '',
        ogImage: album?.ogImage ?? '',
        genre: album?.genre ?? '',
        trackCount: album?.trackCount ?? 0,
        likesCount: album?.likesCount ?? 0,
        recent: album?.recent ?? false,
        veryImportant: album?.veryImportant ?? false,
        artists: mapArtists(album?.artists) ?? [],
        labels: Array.isArray(album?.labels) ? album.labels.map((label: any) => ({ id: label?.id ?? 0, name: label?.name ?? '' })) : [],
        available: album?.available ?? false,
        availableForPremiumUsers: album?.availableForPremiumUsers ?? false,
        availableForOptions: album?.availableForOptions ?? [],
        availableForMobile: album?.availableForMobile ?? false,
        availablePartially: album?.availablePartially ?? false,
        bests: album?.bests ?? [],
        disclaimers: album?.disclaimers ?? [],
        listeningFinished: album?.listeningFinished ?? false,
        trackPosition: {
            volume: album?.trackPosition?.volume ?? 0,
            index: album?.trackPosition?.index ?? 0,
        },
    }))
}

export function normalizeTrack(prev: Track, payload: any): Track {
    if (!payload) return prev
    if (payload?.type === 'refresh') return trackInitials
    const t = payload?.track || {}
    const coverImg = t?.coverUri ? `https://${String(t.coverUri).replace('%%', '1000x1000')}` : prev.albumArt
    return {
        ...prev,
        albumArt: coverImg ?? prev.albumArt,
        isPlaying: payload?.isPlaying ?? prev.isPlaying,
        canMoveBackward: payload?.canMoveBackward ?? prev.canMoveBackward,
        canMoveForward: payload?.canMoveForward ?? prev.canMoveForward,
        status: payload?.status ?? prev.status,
        sourceType: t?.sourceType ?? prev.sourceType,
        ynisonProgress: payload?.ynisonProgress ?? prev.ynisonProgress,
        progress: {
            duration: payload?.progress?.duration ?? prev.progress.duration,
            loaded: payload?.progress?.loaded ?? prev.progress.loaded,
            position: payload?.progress?.position ?? prev.progress.position,
            played: payload?.progress?.played ?? prev.progress.played,
        },
        availableActions: {
            moveBackward: payload?.availableActions?.moveBackward ?? prev.availableActions.moveBackward,
            moveForward: payload?.availableActions?.moveForward ?? prev.availableActions.moveForward,
            repeat: payload?.availableActions?.repeat ?? prev.availableActions.repeat,
            shuffle: payload?.availableActions?.shuffle ?? prev.availableActions.shuffle,
            speed: payload?.availableActions?.speed ?? prev.availableActions.speed,
        },
        actionsStore: {
            repeat: payload?.actionsStore?.repeat ?? prev.actionsStore.repeat,
            shuffle: payload?.actionsStore?.shuffle ?? prev.actionsStore.shuffle,
            isLiked: payload?.actionsStore?.isLiked ?? prev.actionsStore.isLiked,
            isDisliked: payload?.actionsStore?.isDisliked ?? prev.actionsStore.isDisliked,
        },
        currentDevice: payload?.currentDevice ?? prev.currentDevice,
        downloadInfo: payload?.downloadInfo ?? prev.downloadInfo,
        id: t?.id ?? prev.id,
        realId: t?.realId ?? prev.realId,
        title: t?.title ?? prev.title,
        major: {
            id: t?.major?.id ?? prev.major.id,
            name: t?.major?.name ?? prev.major.name,
        },
        version: t?.version,
        available: t?.available ?? prev.available,
        availableForPremiumUsers: t?.availableForPremiumUsers ?? prev.availableForPremiumUsers,
        availableFullWithoutPermission: t?.availableFullWithoutPermission ?? prev.availableFullWithoutPermission,
        availableForOptions: t?.availableForOptions ?? prev.availableForOptions,
        disclaimers: t?.disclaimers ?? prev.disclaimers,
        storageDir: t?.storageDir ?? prev.storageDir,
        durationMs: t?.durationMs ?? prev.durationMs,
        fileSize: t?.fileSize ?? prev.fileSize,
        r128: {
            i: t?.r128?.i ?? prev.r128.i,
            tp: t?.r128?.tp ?? prev.r128.tp,
        },
        fade: {
            inStart: t?.fade?.inStart ?? prev.fade.inStart,
            inStop: t?.fade?.inStop ?? prev.fade.inStop,
            outStart: t?.fade?.outStart ?? prev.fade.outStart,
            outStop: t?.fade?.outStop ?? prev.fade.outStop,
        },
        previewDurationMs: t?.previewDurationMs ?? prev.previewDurationMs,
        artists: mapArtists(t?.artists) ?? prev.artists,
        albums: mapAlbums(t?.albums) ?? prev.albums,
        derivedColors: {
            average: t?.derivedColors?.average ?? prev.derivedColors.average,
            waveText: t?.derivedColors?.waveText ?? prev.derivedColors.waveText,
            miniPlayer: t?.derivedColors?.miniPlayer ?? prev.derivedColors.miniPlayer,
            accent: t?.derivedColors?.accent ?? prev.derivedColors.accent,
        },
        ogImage: t?.ogImage ?? prev.ogImage,
        url: payload?.url ?? prev.url,
        lyricsAvailable: t?.lyricsAvailable ?? prev.lyricsAvailable,
        type: t?.type ?? prev.type,
        rememberPosition: t?.rememberPosition ?? prev.rememberPosition,
        trackSharingFlag: t?.trackSharingFlag ?? prev.trackSharingFlag,
        lyricsInfo: {
            hasAvailableSyncLyrics: t?.lyricsInfo?.hasAvailableSyncLyrics ?? prev.lyricsInfo.hasAvailableSyncLyrics,
            hasAvailableTextLyrics: t?.lyricsInfo?.hasAvailableTextLyrics ?? prev.lyricsInfo.hasAvailableTextLyrics,
        },
        trackSource: t?.trackSource ?? prev.trackSource,
        specialAudioResources: t?.specialAudioResources ?? prev.specialAudioResources,
    }
}

export function areTracksEqual(a: Track, b: Track): boolean {
    if (a === b) return true
    if (a.id !== b.id) return false
    if (a.realId !== b.realId) return false
    if (a.title !== b.title) return false
    if (a.status !== b.status) return false
    if (a.isPlaying !== b.isPlaying) return false
    if (a.albumArt !== b.albumArt) return false
    if (a.durationMs !== b.durationMs) return false
    if (a.progress?.position !== b.progress?.position) return false
    if (a.progress?.played !== b.progress?.played) return false
    if (a.trackSource !== b.trackSource) return false
    if (a.sourceType !== b.sourceType) return false
    const aArtist = (a.artists || []).map(x => x.name).join(',')
    const bArtist = (b.artists || []).map(x => x.name).join(',')
    return aArtist === bArtist
}
