import { Track } from '../api/interfaces/track.interface'

export function truncateLabel(label: string, maxLength = 30) {
    return label.length > maxLength ? label.slice(0, maxLength) : label
}
export const replaceParams = (str: any, track: Track, showVersion: boolean = false) => {
    return str
        .replace('{track}', showVersion && track.version ? `${track.title} (${track.version})` : track.title || '')
        .replace('{artist}', track.artists.map(a => a.name).join(', ') || 'Unknown Artist')
        .replace('{album}', track.albums.map(a => a.title).join(', ') || 'Unknown Album')
}

export function fixStrings(string: string): string {
    if (!string) return string

    if (string.length <= 1) {
        string += 'ㅤ'
    }
    if (string.length > 128) {
        string = string.substring(0, 127)
        string += '…'
    }
    return string
}
class ConvertableLink {
    link?: string
    constructor(link?: string) {
        this.link = link
    }
    toString() {
        return this.link ?? ''
    }
    toWeb() {
        if (!this.link) return undefined
        return `https://music.yandex.ru/${this.link}?utm_source=discord&utm_medium=rich_presence_click`
    }
    toApp() {
        if (!this.link) return undefined
        return `yandexmusic://${this.link}`
    }
}
export function buildShareLinks(t: Track) {
    const albumId = t.albums?.[0]?.id
    const trackId = t.id
    const realTrackId = t.realId
    const artistId = t.artists?.[0]?.id

    const shareTrackPathYnison = new ConvertableLink(albumId && trackId ? `album/${albumId}/track/${trackId}` : undefined)
    const shareTrackPathRegular = new ConvertableLink(albumId && realTrackId ? `album/${albumId}/track/${realTrackId}` : undefined)
    const shareAlbumPath = new ConvertableLink(albumId ? `album/${albumId}` : undefined)
    const shareArtistPath = new ConvertableLink(artistId ? `artist/${artistId}` : undefined)

    return { shareTrackPathYnison, shareTrackPathRegular, shareAlbumPath, shareArtistPath }
}