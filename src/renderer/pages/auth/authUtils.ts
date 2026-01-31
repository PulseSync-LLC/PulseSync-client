import { useEffect } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import MainEvents from '../../../common/types/mainEvents'
import config from '../../api/web_config'
import { staticAsset } from '../../utils/staticAssets'

export const isDevModeEnabled = () => {
    const searchParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return searchParams.get('dev') === 'true'
}

export const useAuthRedirect = (userId: string, navigate: NavigateFunction) => {
    useEffect(() => {
        if (userId !== '-1' && !isDevModeEnabled()) {
            navigate('/', { replace: true })
        }
    }, [userId, navigate])
}

export const openAuthCallback = (navigate: NavigateFunction) => {
    window.open(config.WEBSITE_URL + '/callback')
    navigate('/auth/callback', { replace: true })
}

export const checkUpdateHard = () => {
    window.desktopEvents?.send(MainEvents.CHECK_UPDATE, { hard: true })
}

export const readAndSendTerms = async () => {
    const response = await fetch(staticAsset('assets/policy/terms.ru.md'))
    const fileContent = await response.text()
    window.desktopEvents?.send(MainEvents.OPEN_FILE, fileContent)
}
