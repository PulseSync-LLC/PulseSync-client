import { timeAgo } from '@shared/lib/utils'
import UserInterface from '@entities/user/model/user.interface'
import { t } from '@app/i18n'

export const getStatusColor = (user: UserInterface, dark = false): string => {
    if (user.status === 'online' && user.currentTrack?.status === 'playing') {
        return dark ? '#202F16' : '#A8FF66'
    }
    if (user.status === 'online') {
        return dark ? '#224D57' : '#66E3FF'
    }
    return dark ? '#9DA8CE' : '#434B61'
}

export const getStatus = (user: UserInterface): { text: string; detail: string } => {
    if (user.status === 'online' && user.currentTrack?.status === 'playing') {
        const artists = user.currentTrack.artists?.map(a => a.name).join(', ')
        return {
            text: t('userStatus.listening'),
            detail: `${user.currentTrack.title} - ${artists}`,
        }
    }
    if (user.status === 'online') {
        return {
            text: t('userStatus.online'),
            detail: '',
        }
    }
    if (user.lastOnline) {
        return { text: t('userStatus.offline'), detail: `${timeAgo(Number(user.lastOnline))}` }
    }
    return {
        text: t('userStatus.offline'),
        detail: `💤`,
    }
}
