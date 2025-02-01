import { timeAgo } from './utils'
import UserInterface from '../api/interfaces/user.interface'

export const getStatusColor = (user: UserInterface, dark?: boolean): string => {
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        if (dark) {
            return '#1B311E'
        }
        return '#71DC81'
    }
    if (user.status === 'online') {
        if (dark) {
            return '#1B2932'
        }
        return '#56B2EB'
    }
    if (dark) {
        return '#9b9b9b'
    }
    return '#444444'
}

export const getStatusTooltip = (user: UserInterface): string => {
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        if (user.currentTrack.title) {
            const artists = user.currentTrack.artists
                ?.map((artist) => artist.name)
                .join(', ')
            return `Слушает: ${user.currentTrack.title} — ${artists}`
        }
        return 'Слушает музыку'
    }
    if (user.status === 'online') {
        return 'В сети'
    }
    if (user.lastOnline) {
        return `Был в сети ${timeAgo(Number(user.lastOnline))}`
    }
    return 'Не в сети'
}

export const getStatus = (user: UserInterface): string => {
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        return 'Слушает'
    }
    if (user.status === 'online') {
        return 'В сети'
    }
    if (user.lastOnline) {
        return `Был в сети ${timeAgo(Number(user.lastOnline))}`
    }
    return 'Не в сети'
}
