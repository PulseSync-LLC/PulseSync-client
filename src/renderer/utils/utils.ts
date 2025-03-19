import toast from '../components/toast'
import config from '../api/config'

export const checkInternetAccess = async (): Promise<boolean> => {
    try {
        const response = await fetch('https://google.com', {
            method: 'HEAD',
            mode: 'no-cors',
        })
        return response.ok || response.type === 'opaque'
    } catch (error) {
        console.error('Ошибка проверки доступа в интернет:', error)
        return false
    }
}

export const notifyUserRetries = (retriesLeft: number) => {
    const retryIntervalInSeconds = Number(config.RETRY_INTERVAL_MS) / 1000
    toast.custom('success', 'Попытка подключения.', `Осталось попыток: ${retriesLeft}. Следующая через ${retryIntervalInSeconds} сек.`, {
        icon: '🔄',
        duration: 10000,
    })
}
export const compareVersions = (v1: string, v2: string) => {
    const v1parts = v1.split('.').map(Number)
    const v2parts = v2.split('.').map(Number)

    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
        const a = v1parts[i] || 0
        const b = v2parts[i] || 0
        if (a > b) return 1
        if (a < b) return -1
    }
    return 0
}

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

    const pluralize = (number: number, singular: string, few: string, many: string, singularAccusative?: string) => {
        const mod10 = number % 10
        const mod100 = number % 100

        if (mod10 === 1 && mod100 !== 11) {
            return `${number} ${singularAccusative ?? singular}`
        }
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
            return `${number} ${few}`
        }
        return `${number} ${many}`
    }

    if (seconds < 60) {
        return pluralize(seconds, 'секунда', 'секунды', 'секунд', 'секунду') + ' назад'
    } else if (minutes < 60) {
        return pluralize(minutes, 'минута', 'минуты', 'минут', 'минуту') + ' назад'
    } else if (hours < 24) {
        return pluralize(hours, 'час', 'часа', 'часов') + ' назад'
    } else if (days < 7) {
        return pluralize(days, 'день', 'дня', 'дней', 'день') + ' назад'
    } else if (days < 30) {
        return pluralize(weeks, 'неделя', 'недели', 'недель', 'неделю') + ' назад'
    } else if (days < 365) {
        return pluralize(months, 'месяц', 'месяца', 'месяцев', 'месяц') + ' назад'
    } else {
        return pluralize(years, 'год', 'года', 'лет', 'год') + ' назад'
    }
}
