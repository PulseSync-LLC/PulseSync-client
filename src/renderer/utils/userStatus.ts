import { timeAgo } from './utils'
import UserInterface from '../api/interfaces/user.interface'

export const getStatusColor = (user: UserInterface, dark?: boolean): string => {
    if (user.status === 'online' && user.currentTrack?.status === 'playing') {
        return dark ? '#1B311E' : '#71DC81'
    }

    if (user.status === 'online') {
        return dark ? '#1B2932' : '#56B2EB'
    }

    return dark ? '#5d6275' : '#353845'
}

export const getStatus = (user: UserInterface, full?: boolean): string => {
    if (user.status === 'online' && user.currentTrack?.status === 'playing') {
        if (full) {
            const artists = user.currentTrack.artists?.map(a => a.name).join(', ')
            return `${user.currentTrack.title} — ${artists}`
        }
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
