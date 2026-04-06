import { Track } from '@entities/track/model/track.interface'

export type PlayStatus = 'playing' | 'pause' | 'null'

const statusColors: Record<PlayStatus, string> = {
    playing: '#62FF79',
    pause: '#60C2FF',
    null: '#FFD562',
}

export function getPlayStatus(track?: Track | null): PlayStatus {
    if (!track) {
        return 'null'
    }

    if (track.status === 'playing') {
        return 'playing'
    }

    if (track.status === 'paused' || track.status === 'idle') {
        return 'pause'
    }

    return 'null'
}

export function applyPlayStatusColor(playStatus: PlayStatus) {
    document.documentElement.style.setProperty('--statusColor', statusColors[playStatus] || statusColors.null)
}
