import { useEffect } from 'react'

import config from '@common/appConfig'
import rendererHttpClient from '@shared/api/http/client'
import { desktopApi } from '@shared/desktop/desktopApi'
import { staticAsset } from '@shared/lib/staticAssets'

import type { NavigateFunction } from 'react-router-dom'

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
    void Promise.resolve(desktopApi.auth.startBrowserAuth()).finally(() => {
        const callbackUrl = new URL('/callback', config.WEBSITE_URL)
        callbackUrl.searchParams.set('source', 'app')
        callbackUrl.searchParams.set('clientAuth', 'v2')
        window.open(callbackUrl.toString())
        navigate('/auth/callback', { replace: true })
    })
}

export const checkUpdateHard = () => {
    desktopApi.updates.check({ hard: true })
}

export const readAndSendTerms = async () => {
    const url = new URL(staticAsset('assets/policy/terms.ru.md'), window.location.origin).toString()
    const response = await rendererHttpClient.get<string>(url, {
        responseType: 'text',
    })
    const fileContent = response.data
    desktopApi.system.openTextFile(fileContent)
}
