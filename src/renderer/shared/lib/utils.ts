import config from '@common/appConfig'
import { t } from '@app/i18n'
import rendererHttpClient from '@shared/api/http/client'
import toast from '@shared/ui/toast'

export const checkInternetAccess = async (): Promise<boolean> => {
    try {
        const response = await rendererHttpClient.get(`${config.SERVER_v2_URL}/api/v2/health`, {
            responseType: 'text',
            timeoutMs: 10000,
        })
        return response.status === 200
    } catch (error) {
        console.error(t('utils.internetCheckError'), error)
        return false
    }
}

export const notifyUserRetries = (retriesLeft: number) => {
    const retryIntervalInSeconds = Number(config.RETRY_INTERVAL_MS) / 1000
    toast.custom('success', t('utils.connectionAttemptTitle'), t('utils.connectionAttemptMessage', { retriesLeft, retryIntervalInSeconds }), {
        icon: '🔄',
        duration: 10000,
    })
}

export { compareVersions } from '@common/compareVersions'

export const timeAgo = (timestamp: number) => {
    const now = Date.now()
    let diff = now - timestamp
    if (diff < 0) diff = 0
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    const weeks = Math.floor(days / 7)
    const months = Math.floor(days / 30)
    const years = Math.floor(days / 365)
    if (seconds < 60) {
        return t('utils.timeAgo.seconds', { count: seconds })
    } else if (minutes < 60) {
        return t('utils.timeAgo.minutes', { count: minutes })
    } else if (hours < 24) {
        return t('utils.timeAgo.hours', { count: hours })
    } else if (days < 7) {
        return t('utils.timeAgo.days', { count: days })
    } else if (days < 30) {
        return t('utils.timeAgo.weeks', { count: weeks })
    } else if (days < 365) {
        return t('utils.timeAgo.months', { count: months })
    } else {
        return t('utils.timeAgo.years', { count: years })
    }
}

export const errorTypesToShow = new Set([
    'checksum_mismatch',
    'mod_filename_missing',
    'file_not_found',
    'file_copy_error',
    'unexpected_error',
    'download_error',
    'writer_error',
    'finish_error',
    'download_outer_error',
    'backup_not_found',
    'remove_mod_error',
    'linux_permissions_required',
])

export { areTracksEqual, mapAlbums, mapArtists, normalizeTrack } from '@common/player/track'
