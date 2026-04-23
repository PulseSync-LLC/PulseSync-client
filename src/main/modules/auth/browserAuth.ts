import { BrowserWindow, app } from 'electron'
import isAppDev from '../../utils/isAppDev'
import RendererEvents from '../../../common/types/rendererEvents'
import logger from '../logger'
import { getState } from '../state'

const State = getState()
const BROWSER_AUTH_ACTION = 'BROWSER_AUTH'
const BROWSER_AUTH_CANCELLED_KEY = 'auth.browserAuthCancelled'

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

export const beginBrowserAuthFlow = (): void => {
    State.set(BROWSER_AUTH_CANCELLED_KEY, false)
}

export const cancelBrowserAuthFlow = (): void => {
    State.set(BROWSER_AUTH_CANCELLED_KEY, true)
}

export const isBrowserAuthFlowCancelled = (): boolean => State.get(BROWSER_AUTH_CANCELLED_KEY) === true

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

export const readBrowserAuthFromParams = (params: URLSearchParams): BrowserAuthCredentials | null => {
    const userId = params.get('userId') || params.get('userID') || params.get('user_id') || params.get('id')
    const token = params.get('token') || params.get('accessToken') || params.get('access_token')
    if (!userId || !token) return null
    return { userId: trimQuotes(userId), token: trimQuotes(token) }
}

export const extractBrowserAuthCredentialsFromUrl = (rawUrl: string): BrowserAuthCredentials | null => {
    if (!rawUrl || !rawUrl.toLowerCase().startsWith('pulsesync://')) return null

    try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol !== 'pulsesync:') return null

        const queryCredentials = readBrowserAuthFromParams(parsed.searchParams)
        if (queryCredentials) return queryCredentials

        if (parsed.hash?.startsWith('#')) {
            const hashCredentials = readBrowserAuthFromParams(new URLSearchParams(parsed.hash.slice(1)))
            if (hashCredentials) return hashCredentials
        }
    } catch {
        return null
    }

    return null
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

        const queryCredentials = readBrowserAuthFromParams(parsed.searchParams)
        if (queryCredentials) return queryCredentials

        if (parsed.hash?.startsWith('#')) {
            const hashCredentials = readBrowserAuthFromParams(new URLSearchParams(parsed.hash.slice(1)))
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
    window?.focus()
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

    if (isBrowserAuthFlowCancelled()) {
        logger.socketManager.info(`Ignored browser auth for user ${userId}: auth flow was cancelled.`)
        return false
    }

    try {
        State.set('tokens.token', token)
        State.set(BROWSER_AUTH_CANCELLED_KEY, false)
        logger.socketManager.info(`${isAppDev ? 'Dev mode auth accepted' : 'Auth accepted'} for user ${userId}.`)
        notifyAuthSuccess(window, client)
        return true
    } catch (error) {
        logger.socketManager.error(`Error processing authentication for user ${userId}: ${error}`)
        app.quit()
        return false
    }
}
