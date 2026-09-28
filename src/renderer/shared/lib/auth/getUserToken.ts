import { desktopApi } from '@shared/desktop/desktopApi'

let cachedUserToken = ''

const getUserToken = () => {
    return cachedUserToken
}

export default getUserToken

export const getUserTokenAsync = async () => {
    cachedUserToken = await desktopApi.auth.getToken()
    return cachedUserToken
}

export const setCachedUserToken = (token: string) => {
    cachedUserToken = token
}

export const clearCachedUserToken = () => {
    cachedUserToken = ''
}
