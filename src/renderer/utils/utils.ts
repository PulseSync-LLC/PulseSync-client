import toast from '../api/toast'
import config from '../api/config'

export const checkInternetAccess = async (): Promise<boolean> => {
    try {
        const response = await fetch('https://api.pulsesync.dev', {
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
    toast.success(
        `Попытка подключения. Осталось попыток: ${retriesLeft}. Следующая через ${retryIntervalInSeconds} сек.`,
        {
            icon: '🔄',
            duration: 10000,
        },
    )
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