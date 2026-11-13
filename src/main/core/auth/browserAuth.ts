import { createHash, randomBytes } from 'node:crypto'

import { dialog, shell } from 'electron'

import config from '../../../common/appConfig'
import RendererEvents from '../../../common/types/rendererEvents'
import { t } from '../../shared/i18n'
import logger from '../../shared/logger'
import isAppDev from '../../shared/utils/isAppDev'
import { authV2Request, installV2Session, parseV2Credentials } from './session'

import type { BrowserWindow } from 'electron'

const AUTH_EXCHANGE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface BrowserAuthCredentials {
    v2: NonNullable<ReturnType<typeof parseV2Credentials>>
    flow: BrowserAuthFlow
    requestedAt: number
}

type BrowserAuthFlow = { verifier: string; startedAt: number }
let v2Flow: BrowserAuthFlow | null = null

export async function openBrowserAuthFlow(): Promise<boolean> {
    const flow = { verifier: randomBytes(32).toString('base64url'), startedAt: Date.now() }
    v2Flow = flow
    try {
        const challenge = createHash('sha256').update(flow.verifier).digest('base64url')
        const availabilityUrl = new URL('/auth/v2', config.SERVER_URL)
        availabilityUrl.searchParams.set('challenge', challenge)
        const response = await fetch(availabilityUrl, {
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
        })
        if (!response.ok || (await response.json())?.enabled !== true) {
            if (v2Flow === flow) cancelBrowserAuthFlow()
            return false
        }
        if (v2Flow !== flow) return false
        const url = new URL('/callback', config.WEBSITE_URL)
        url.searchParams.set('source', 'app')
        url.searchParams.set('authVersion', '2')
        url.searchParams.set('challenge', challenge)
        await shell.openExternal(url.toString())
        return true
    } catch {
        if (v2Flow === flow) cancelBrowserAuthFlow()
        return false
    }
}

export const cancelBrowserAuthFlow = (): void => {
    v2Flow = null
}

export const extractBrowserAuthCodeFromUrl = (rawUrl: string): string | null => {
    if (!rawUrl || !rawUrl.toLowerCase().startsWith('pulsesync://')) return null

    try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol !== 'pulsesync:') return null
        if (parsed.searchParams.get('authVersion') !== '2') return null
        const code = parsed.searchParams.get('code') ?? ''
        return AUTH_EXCHANGE_CODE_PATTERN.test(code) ? code : null
    } catch {
        return null
    }
}

export const exchangeBrowserAuthCode = async (code: string): Promise<BrowserAuthCredentials | null> => {
    const flow = v2Flow
    if (!AUTH_EXCHANGE_CODE_PATTERN.test(code)) return null
    if (!flow || Date.now() - flow.startedAt > 12 * 60_000) {
        logger.socketManager.warn('Browser authentication callback has no active sign-in attempt')
        return null
    }
    try {
        const requestedAt = Date.now()
        const response = await authV2Request('/oauth/exchange', { code, verifier: flow.verifier })
        if (!response.ok) {
            logger.socketManager.warn(`Browser authentication exchange failed (HTTP ${response.status})`)
            return null
        }
        const credentials = parseV2Credentials(await response.json())
        if (!credentials) logger.socketManager.warn('Browser authentication exchange returned invalid credentials')
        return credentials ? { v2: credentials, flow, requestedAt } : null
    } catch {
        logger.socketManager.error('Failed to exchange browser authentication code')
        return null
    }
}

export const processBrowserAuth = async (
    credentials: BrowserAuthCredentials,
    { window }: { window?: BrowserWindow | null } = {},
): Promise<boolean> => {
    const { v2, flow, requestedAt } = credentials
    if (flow !== v2Flow) {
        void authV2Request('/logout', { refreshToken: v2.refreshToken }).catch(() => {})
        return false
    }

    try {
        installV2Session(v2, requestedAt)
    } catch {
        v2Flow = null
        void authV2Request('/logout', { refreshToken: v2.refreshToken }).catch(() => {})
        logger.socketManager.error('Could not store the browser authentication session')
        dialog.showErrorBox(t('main.auth.storageErrorTitle'), t('main.auth.storageErrorMessage'))
        return false
    }

    v2Flow = null
    logger.socketManager.info(`${isAppDev ? 'Dev mode auth accepted' : 'Auth accepted'} for user ${v2.userId}.`)
    if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore()
        window.show()
        window.moveTop()
        window.focus()
        window.webContents.send(RendererEvents.AUTH_SUCCESS)
    }
    return true
}
