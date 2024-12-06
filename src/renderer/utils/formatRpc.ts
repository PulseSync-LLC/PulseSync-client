import { Track } from '../api/interfaces/track.interface'

export function timeDifference(time1: string, time2: string): string {
    function toSeconds(time: string): number {
        if (!time) return 0
        const [minutes, seconds] = time.split(':').map(Number)

        if (
            isNaN(minutes) ||
            isNaN(seconds) ||
            (minutes === 0 && seconds === 0)
        ) {
            return 0
        }

        return minutes * 60 + seconds
    }

    function toTimeString(seconds: number): string {
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = seconds % 60
        return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    }

    const seconds1 = toSeconds(time1)
    const seconds2 = toSeconds(time2)

    const differenceInSeconds = Math.abs(seconds2 - seconds1)

    return toTimeString(differenceInSeconds)
}

export const replaceParams = (str: any, track: Track) => {
    return str
        .replace('{track}', track.title || '')
        .replace('{artist}', track.artists.map(a => a.name).join(', ') || '')
}
export function fixStrings(string: string): string {
    if (!string) return string;
    if (string.length <= 1) {
        string += 'ㅤ';
    }
    if (string.length > 128) {
        string = string.substring(0, 127);
        string += '…';
    }
    return string;
}