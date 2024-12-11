import { Track } from 'yandex-music-client'

export const getTrackLabel = (track: Track) => {
    return truncate(
        `${track.title} – ${track.artists.map((a) => a.name).join(', ')}`,
        45,
    )
}

export const truncate = (str: string, n: number) => {
    return str.length > n ? str.substr(0, n - 1) + '...' : str
}
