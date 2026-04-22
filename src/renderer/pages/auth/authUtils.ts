import { useEffect } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import MainEvents from '@common/types/mainEvents'
import config from '@common/appConfig'
import rendererHttpClient from '@shared/api/http/client'
import { staticAsset } from '@shared/lib/staticAssets'

export const isDevModeEnabled = () => {
    const searchParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return searchParams.get('dev') === 'true'
}

export const useAuthRedirect = (userId: string, navigate: NavigateFunction) => {
    useEffect(() => {
        if (userId !== '-1' && !isDevModeEnabled()) {
            navigate('/home', { replace: true })
        }
    }, [userId, navigate])
}

export const openAuthCallback = (navigate: NavigateFunction) => {
    void Promise.resolve(window.desktopEvents?.invoke(MainEvents.START_BROWSER_AUTH)).finally(() => {
        window.open(config.WEBSITE_URL + '/callback?source=app')
        navigate('/auth/callback', { replace: true })
    })
}

export const checkUpdateHard = () => {
    window.desktopEvents?.send(MainEvents.CHECK_UPDATE, { hard: true })
}

export const readAndSendTerms = async () => {
    const url = new URL(staticAsset('assets/policy/terms.ru.md'), window.location.origin).toString()
    const response = await rendererHttpClient.get<string>(url, {
        responseType: 'text',
    })
    const fileContent = response.data
    window.desktopEvents?.send(MainEvents.OPEN_FILE, fileContent)
}
