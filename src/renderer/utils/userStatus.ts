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
        return '#5d6275'
    }
    return '#353845'
}

export const getStatus = (user: UserInterface, full?: boolean): string => {
    if (user.currentTrack && user.currentTrack.status === 'playing') {
        if (full) {
            const artists = user.currentTrack.artists
                ?.map((artist) => artist.name)
                .join(', ')
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

export const getDynamicStatus = (
    user: UserInterface,
    callback: (status: string) => void,
): (() => void) => {
    let timeoutId: NodeJS.Timeout | null = null

    const updateStatus = () => {
        if (user.currentTrack && user.currentTrack.status === 'playing') {
            const currentStatus = getStatus(user, false)
            const fullStatus = getStatus(user, true) 

            callback(currentStatus === 'Слушает' ? fullStatus : 'Слушает')

            timeoutId = setTimeout(updateStatus, 3000)
        }
    }

    updateStatus()

    return () => {
        if (timeoutId) {
            clearTimeout(timeoutId)
        }
    }
}