import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, safeStorage } from 'electron'

import config from '@common/appConfig'
import RendererEvents from '@common/types/rendererEvents'

import logger from '../../shared/logger'
import { getState } from '../state'

const State = getState()
const REFRESH_PATTERN = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/
const V2_SESSION_KEY = 'tokens.v2'
const MIGRATION_ID_KEY = 'auth.v2MigrationId'
const RANDOM_PATTERN = /^[A-Za-z0-9_-]{43}$/
const REFRESH_WINDOW_MS = 60_000
const ACTIVITY_INTERVAL_MS = 5 * 60_000

type SavedSession = { refreshToken: string; rotationId: string }
type StoredSession = SavedSession | { safeStorage: string }
export type V2Credentials = { accessToken: string; refreshToken: string; expiresIn: number; userId: string; type: 'app' }

let saved: SavedSession | null | undefined
let access: { token: string; expiresAt: number } | null = null
let previousAccess: { token: string; expiresAt: number } | null = null
let generation = 0
let refreshPending: Promise<string> | null = null
let lastActivity = 0
let migrationRejected = false

const previousSessionFile = () => path.join(app.getPath('userData'), 'auth-session-v2')

function canUseSafeStorage(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
}

function isSavedSession(value: unknown): value is SavedSession {
    if (!value || typeof value !== 'object') return false
    const { refreshToken, rotationId } = value as Partial<SavedSession>
    return typeof refreshToken === 'string' && REFRESH_PATTERN.test(refreshToken) && typeof rotationId === 'string' && RANDOM_PATTERN.test(rotationId)
}

function decryptSession(encrypted: Buffer): SavedSession | null {
    if (!canUseSafeStorage()) return null
    const record: unknown = JSON.parse(safeStorage.decryptString(encrypted))
    return isSavedSession(record) ? record : null
}

function readPreviousSession(): SavedSession | null {
    try {
        return decryptSession(readFileSync(previousSessionFile()))
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') logger.main.warn('Could not import the previous desktop session')
        return null
    }
}

function readStoredSession(record: unknown): SavedSession | null {
    if (isSavedSession(record)) return record
    if (!record || typeof record !== 'object') return null
    const encrypted = 'safeStorage' in record ? record.safeStorage : process.platform === 'win32' && 'dpapi' in record ? record.dpapi : null
    if (typeof encrypted !== 'string' || !encrypted) return null

    try {
        return decryptSession(Buffer.from(encrypted, 'base64'))
    } catch {
        logger.main.warn('Could not decrypt the saved desktop session')
        return null
    }
}

function readSession(): SavedSession | null {
    if (saved !== undefined) return saved
    const record: unknown = State.get(V2_SESSION_KEY)
    if (record && typeof record === 'object') {
        // Retry decryption on the next call if the system store is temporarily unavailable.
        const decoded = readStoredSession(record)
        if (decoded) saved = decoded
        return decoded
    }

    const previous = readPreviousSession()
    if (previous) installSavedSession(previous)
    else saved = null
    return previous
}

function encodeSession(record: SavedSession): StoredSession {
    try {
        if (canUseSafeStorage()) {
            return { safeStorage: safeStorage.encryptString(JSON.stringify(record)).toString('base64') }
        }
    } catch {
        logger.main.warn('Could not encrypt the desktop session with safeStorage')
    }
    return record
}

function persistSession(record: SavedSession): void {
    State.set(V2_SESSION_KEY, encodeSession(record))
    saved = record
}

function installSavedSession(record: SavedSession): void {
    State.set('tokens', { token: '', v2: encodeSession(record) })
    saved = record
    try {
        rmSync(previousSessionFile(), { force: true })
        State.delete(MIGRATION_ID_KEY)
    } catch {
        logger.main.warn('Could not clean up the previous desktop credentials')
    }
}

export function parseV2Credentials(raw: unknown): V2Credentials | null {
    if (!raw || typeof raw !== 'object') return null
    const data = raw as Partial<V2Credentials>
    if (
        data.type !== 'app' ||
        typeof data.userId !== 'string' ||
        !data.userId ||
        typeof data.accessToken !== 'string' ||
        !data.accessToken ||
        typeof data.refreshToken !== 'string' ||
        !REFRESH_PATTERN.test(data.refreshToken) ||
        data.expiresIn !== 900
    )
        return null
    return data as V2Credentials
}

function acceptAccess(credentials: V2Credentials, requestedAt: number): string {
    access = { token: credentials.accessToken, expiresAt: requestedAt + credentials.expiresIn * 1000 }
    return access.token
}

export function currentAuthToken(): string {
    return access?.token ?? ''
}

export function currentAuthSessionId(): string {
    return saved ? saved.refreshToken.split('.')[0] : currentAuthToken()
}

export function isCurrentAuthToken(token: string): boolean {
    if (!token) return false
    return token === currentAuthToken() || (previousAccess?.token === token && previousAccess.expiresAt > Date.now())
}

function clearLocalSession(): void {
    rmSync(previousSessionFile(), { force: true })
    State.set('tokens', { token: '' })
    generation++
    saved = null
    access = null
    previousAccess = null
    refreshPending = null
    lastActivity = 0
    migrationRejected = true
    State.delete(MIGRATION_ID_KEY)
}

export function installV2Session(credentials: V2Credentials, requestedAt: number): void {
    installSavedSession({ refreshToken: credentials.refreshToken, rotationId: randomBytes(32).toString('base64url') })
    generation++
    refreshPending = null
    previousAccess = null
    lastActivity = 0
    acceptAccess(credentials, requestedAt)
}

async function migrateLegacySession(started: number, requestedAt: number): Promise<string> {
    const legacyToken: unknown = State.get('tokens.token')
    if (migrationRejected || typeof legacyToken !== 'string' || !legacyToken) return ''
    let migrationId: unknown = State.get(MIGRATION_ID_KEY)
    if (typeof migrationId !== 'string' || !RANDOM_PATTERN.test(migrationId)) {
        migrationId = randomBytes(32).toString('base64url')
        State.set(MIGRATION_ID_KEY, migrationId)
    }
    const response = await authV2Request('/migrate', { migrationId }, legacyToken)
    if (started !== generation) return currentAuthToken()
    if (response.status === 401) {
        migrationRejected = true
        return ''
    }
    if (!response.ok) throw new Error('AUTH_MIGRATION_UNAVAILABLE')
    const credentials = parseV2Credentials(await response.json())
    if (started !== generation) return currentAuthToken()
    if (!credentials) throw new Error('AUTH_MIGRATION_INVALID_RESPONSE')
    try {
        installV2Session(credentials, requestedAt)
    } catch {
        migrationRejected = true
        return ''
    }
    return currentAuthToken()
}

export async function authV2Request(pathname: string, body: object, token?: string): Promise<Response> {
    return fetch(new URL(`/auth/v2${pathname}`, config.SERVER_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    })
}

function notifySessionExpired(): void {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(RendererEvents.AUTH_SUCCESS)
}

async function refreshSession(record: SavedSession, started: number, requestedAt: number): Promise<string> {
    const response = await authV2Request('/refresh', record)
    if (started !== generation) return ''
    if (response.status === 401) {
        clearLocalSession()
        notifySessionExpired()
        return ''
    }
    if (!response.ok) throw new Error('AUTH_REFRESH_FAILED')

    const credentials = parseV2Credentials(await response.json())
    if (started !== generation) return ''
    if (!credentials) throw new Error('AUTH_REFRESH_INVALID_RESPONSE')

    persistSession({ refreshToken: credentials.refreshToken, rotationId: randomBytes(32).toString('base64url') })
    previousAccess = access
    return acceptAccess(credentials, requestedAt)
}

export async function getAuthToken(): Promise<string> {
    if (access && access.expiresAt - Date.now() > REFRESH_WINDOW_MS) return access.token
    if (refreshPending) return refreshPending

    const record = readSession()
    const started = generation
    const requestedAt = Date.now()
    const request = record ? refreshSession(record, started, requestedAt) : migrateLegacySession(started, requestedAt)
    refreshPending = request

    try {
        return await request
    } catch {
        if (started !== generation) return ''
        if (access && access.expiresAt > Date.now()) return access.token
        throw new Error('AUTH_REFRESH_UNAVAILABLE')
    } finally {
        if (refreshPending === request) refreshPending = null
    }
}

export async function deleteAuthToken(): Promise<void> {
    let record: SavedSession | null = null
    try {
        record = readSession()
    } catch {
        logger.main.warn('Could not read the desktop session before logout')
    }
    clearLocalSession()
    if (!record) return
    try {
        const response = await authV2Request('/logout', record)
        if (!response.ok) throw new Error('AUTH_LOGOUT_FAILED')
    } catch {
        logger.main.warn('Could not revoke the desktop session')
    }
}

export function recordAuthActivity(): void {
    if (!saved || Date.now() - lastActivity < ACTIVITY_INTERVAL_MS) return
    lastActivity = Date.now()
    const started = generation
    void getAuthToken()
        .then(async token => {
            if (started !== generation || !token) return
            const response = await authV2Request('/activity', {}, token)
            if (!response.ok) throw new Error('AUTH_ACTIVITY_FAILED')
        })
        .catch(() => {
            if (started === generation) lastActivity = 0
        })
}
