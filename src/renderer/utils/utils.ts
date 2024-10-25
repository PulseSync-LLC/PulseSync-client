import toast from '../api/toast'
import config from '../api/config'

export const checkInternetAccess = async (): Promise<boolean> => {
    try {
        const response = await fetch('https://www.google.com', {
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