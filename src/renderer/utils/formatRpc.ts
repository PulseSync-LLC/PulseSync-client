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
