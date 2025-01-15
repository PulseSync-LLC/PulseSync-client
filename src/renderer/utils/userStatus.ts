import { timeAgo } from './utils'
import UserInterface from '../api/interfaces/user.interface'

export const getStatusColor = (user: UserInterface): string => {
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        return '#e64988'
    }
    if (user.status === 'online') {
        return '#62FF79'
    }
    return '#707992'
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
        return 'Сейчас в сети'
    }
    if (user.lastOnline) {
        return `Был в сети: ${timeAgo(Number(user.lastOnline))}`
    }
    return 'Не в сети'
}
