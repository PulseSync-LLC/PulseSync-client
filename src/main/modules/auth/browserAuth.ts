import { BrowserWindow, app } from 'electron'
import isAppDev from 'electron-is-dev'
import axios from 'axios'
import config from '@common/appConfig'
import RendererEvents from '../../../common/types/rendererEvents'
import logger from '../logger'
import { getState } from '../state'

const State = getState()
const BROWSER_AUTH_ACTION = 'BROWSER_AUTH'

export interface BrowserAuthCredentials {
    userId: string
    token: string
}

interface BrowserAuthClientLike {
    send: (channel: string, ...args: any[]) => void
}

const trimQuotes = (value: string): string => value.trim().replace(/^["']|["']$/g, '')

const normalizeActionToken = (value: string): string => trimQuotes(value).replace(/-/g, '_').toUpperCase()

const isBrowserAuthAction = (value: string): boolean => normalizeActionToken(value) === BROWSER_AUTH_ACTION

const pickAuthCredentials = (raw: unknown): BrowserAuthCredentials | null => {
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    const userIdRaw = obj.userId ?? obj.userID ?? obj.user_id ?? obj.id
    const tokenRaw = obj.token ?? obj.accessToken ?? obj.access_token
    if (typeof userIdRaw !== 'string' || typeof tokenRaw !== 'string') return null

    const userId = trimQuotes(userIdRaw)
    const token = trimQuotes(tokenRaw)
    if (!userId || !token) return null
    return { userId, token }
}

const readAuthFromParams = (params: URLSearchParams): BrowserAuthCredentials | null => {
    const userId = params.get('userId') || params.get('userID') || params.get('user_id') || params.get('id')
    const token = params.get('token') || params.get('accessToken') || params.get('access_token')
    if (!userId || !token) return null
    return { userId: trimQuotes(userId), token: trimQuotes(token) }
}

export const extractBrowserAuthFromPayload = (payload: unknown): BrowserAuthCredentials | null => {
    const direct = pickAuthCredentials(payload)
    if (direct) return direct

    if (payload && typeof payload === 'object') {
        const nested = pickAuthCredentials((payload as Record<string, unknown>).args)
        if (nested) return nested
    }

    return null
}

export const extractBrowserAuthFromDeepLink = (rawUrl: string): BrowserAuthCredentials | null => {
    if (!rawUrl || !rawUrl.toLowerCase().startsWith('pulsesync://')) return null

    try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol !== 'pulsesync:') return null

        const pathParts = parsed.pathname.split('/').filter(Boolean)
        const hasAction = isBrowserAuthAction(parsed.hostname) || pathParts.some(isBrowserAuthAction)
        if (!hasAction) return null

        const queryCredentials = readAuthFromParams(parsed.searchParams)
        if (queryCredentials) return queryCredentials

        if (parsed.hash?.startsWith('#')) {
            const hashCredentials = readAuthFromParams(new URLSearchParams(parsed.hash.slice(1)))
            if (hashCredentials) return hashCredentials
        }
    } catch {
        return null
    }

    return null
}

const notifyAuthSuccess = (window: BrowserWindow | null | undefined, client?: BrowserAuthClientLike | null): void => {
    window?.webContents.send(RendererEvents.AUTH_SUCCESS)
    client?.send(RendererEvents.AUTH_SUCCESS)
    window?.show()
}

export const processBrowserAuth = async (
    credentials: BrowserAuthCredentials,
    options?: {
        window?: BrowserWindow | null
        client?: BrowserAuthClientLike | null
    },
): Promise<boolean> => {
    const { window, client } = options || {}
    const userId = trimQuotes(credentials?.userId || '')
    const token = trimQuotes(credentials?.token || '')

    if (!userId || !token) {
        logger.socketManager.error('Invalid authentication data received from browser.')
        app.quit()
        return false
    }

    try {
        if (isAppDev) {
            State.set('tokens.token', token)
            notifyAuthSuccess(window, client)
            return true
        }

        const { data } = await axios.get(`${config.SERVER_URL}/api/v1/user/${userId}/access`)
        if (!data.ok || !data.access) {
            logger.socketManager.error(`Access denied for user ${userId}, quitting application.`)
            app.quit()
            return false
        }

        State.set('tokens.token', token)
        logger.socketManager.info(`Access confirmed for user ${userId}.`)
        notifyAuthSuccess(window, client)
        return true
    } catch (error) {
        logger.socketManager.error(`Error processing authentication for user ${userId}: ${error}`)
        app.quit()
        return false
    }
}
