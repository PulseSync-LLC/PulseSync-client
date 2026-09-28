import { app } from 'electron'

import axios from 'axios'

import config from '../../../common/appConfig'
import RendererEvents from '../../../common/types/rendererEvents'
import isAppDev from '../../utils/isAppDev'
import logger from '../logger'
import { getState } from '../state'

import type { BrowserWindow } from 'electron'

const State = getState()
const BROWSER_AUTH_CANCELLED_KEY = 'auth.browserAuthCancelled'
const AUTH_EXCHANGE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface BrowserAuthCredentials {
    userId: string
    token: string
}

interface BrowserAuthClientLike {
    send: (channel: string, ...args: any[]) => void
}

const trimQuotes = (value: string): string => value.trim().replace(/^["']|["']$/g, '')

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

export const extractBrowserAuthCodeFromUrl = (rawUrl: string): string | null => {
    if (!rawUrl || !rawUrl.toLowerCase().startsWith('pulsesync://')) return null

    try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol !== 'pulsesync:') return null
        const code = trimQuotes(parsed.searchParams.get('code') || '')
        return AUTH_EXCHANGE_CODE_PATTERN.test(code) ? code : null
    } catch {
        return null
    }
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

export const exchangeBrowserAuthCode = async (code: string): Promise<BrowserAuthCredentials | null> => {
    if (!AUTH_EXCHANGE_CODE_PATTERN.test(code)) return null
    try {
        const response = await axios.post<BrowserAuthCredentials>(
            `${config.SERVER_URL}/auth/oauth/exchange`,
            { code },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
        )
        return pickAuthCredentials(response.data)
    } catch (error) {
        logger.socketManager.error(`Failed to exchange browser authentication code: ${error instanceof Error ? error.message : String(error)}`)
        return null
    }
}

const notifyAuthSuccess = (window: BrowserWindow | null | undefined, client?: BrowserAuthClientLike | null): void => {
    window?.show()
    window?.focus()
    window?.moveTop()
    window?.webContents.send(RendererEvents.AUTH_SUCCESS)
    client?.send(RendererEvents.AUTH_SUCCESS)
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
