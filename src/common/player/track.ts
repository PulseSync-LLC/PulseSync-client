import trackInitials from './trackInitials'

import type { Track } from './track.types'

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

function resolveTrackCoverUri(track: any): string {
    const directCoverUri = typeof track?.coverUri === 'string' ? track.coverUri.trim() : ''
    if (directCoverUri) return directCoverUri

    const albumCoverUri = typeof track?.albums?.[0]?.coverUri === 'string' ? track.albums[0].coverUri.trim() : ''
    return albumCoverUri
}

export function normalizeTrack(prev: Track, payload: any): Track {
    if (!payload) return prev
    if (payload?.type === 'refresh') return trackInitials
    const prevProgress = prev.progress ?? trackInitials.progress!
    const prevAvailableActions = prev.availableActions ?? trackInitials.availableActions!
    const prevActionsStore = prev.actionsStore ?? trackInitials.actionsStore!
    const t = payload?.track || {}
    const nextId = t?.id ?? prev.id
    const nextRealId = t?.realId ?? prev.realId
    const hasTrackChanged = nextId !== prev.id || nextRealId !== prev.realId
    const incomingCoverUri = resolveTrackCoverUri(t)
    const nextCoverUri = incomingCoverUri || (hasTrackChanged ? '' : prev.coverUri)

    let nextAlbumArt = prev.albumArt
    if (nextCoverUri) {
        nextAlbumArt = `https://${nextCoverUri.replace('%%', '1000x1000')}`
    } else if (hasTrackChanged) {
        nextAlbumArt = ''
    }

    return {
        ...prev,
        albumArt: nextAlbumArt,
        coverUri: nextCoverUri,
        isPlaying: payload?.isPlaying ?? prev.isPlaying,
        canMoveBackward: payload?.canMoveBackward ?? prev.canMoveBackward,
        canMoveForward: payload?.canMoveForward ?? prev.canMoveForward,
        status: payload?.status ?? prev.status,
        sourceType: t?.sourceType ?? prev.sourceType,
        ynisonProgress: payload?.ynisonProgress ?? prev.ynisonProgress,
        progress: {
            duration: payload?.progress?.duration ?? prevProgress.duration,
            loaded: payload?.progress?.loaded ?? prevProgress.loaded,
            position: payload?.progress?.position ?? prevProgress.position,
            played: payload?.progress?.played ?? prevProgress.played,
        },
        availableActions: {
            moveBackward: payload?.availableActions?.moveBackward ?? prevAvailableActions.moveBackward,
            moveForward: payload?.availableActions?.moveForward ?? prevAvailableActions.moveForward,
            repeat: payload?.availableActions?.repeat ?? prevAvailableActions.repeat,
            shuffle: payload?.availableActions?.shuffle ?? prevAvailableActions.shuffle,
            speed: payload?.availableActions?.speed ?? prevAvailableActions.speed,
        },
        actionsStore: {
            repeat: payload?.actionsStore?.repeat ?? prevActionsStore.repeat,
            shuffle: payload?.actionsStore?.shuffle ?? prevActionsStore.shuffle,
            isLiked: payload?.actionsStore?.isLiked ?? prevActionsStore.isLiked,
            isDisliked: payload?.actionsStore?.isDisliked ?? prevActionsStore.isDisliked,
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
