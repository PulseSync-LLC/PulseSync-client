export function timeDifference(time1: string, time2: string): string {
    function toSeconds(time: string): number {
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

export const replaceParams = (str: any, track: any) => {
    return str
        .replace('{track}', track.playerBarTitle || '')
        .replace('{artist}', track.artist || '')
        .replace('{startTime}', track.timecodes[0] || '')
        .replace('{endTime}', track.timecodes[1] || '')
        .replace(
            '{endTime - startTime}',
            timeDifference(track.timecodes[1], track.timecodes[0]) || '',
        )
}
