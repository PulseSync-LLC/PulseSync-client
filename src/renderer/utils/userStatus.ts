import { timeAgo } from './utils'
import UserInterface from '../api/interfaces/user.interface'

export const getStatusColor = (user: UserInterface, dark = false): string => {
    if (user.status === 'online' && user.currentTrack?.status === 'playing') {
        return dark ? '#202F16' : '#A8FF66'
    }
    if (user.status === 'online') {
        return dark ? '#224D57' : '#66E3FF'
    }
    return dark ? '#9DA8CE' : '#434B61'
}

export const getStatus = (user: UserInterface): { text: string; detail: string | null } => {
    if (user.status === 'online' && user.currentTrack?.status === 'playing') {
        const artists = user.currentTrack.artists?.map(a => a.name).join(', ')
        return {
            text: 'Слушает',
            detail: `${user.currentTrack.title} - ${artists}` || null,
        }
    }
    if (user.status === 'online') {
        return {
            text: 'В сети',
            detail: null,
        }
    }
    if (user.lastOnline) {
        return {
            text: 'Не в сети',
            detail: timeAgo(Number(user.lastOnline)),
        }
    }
    return {
        text: 'Не в сети',
        detail: `💤`,
    }
}
