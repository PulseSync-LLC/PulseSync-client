import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import logger from '../logger'
import { getState } from '../state'
import { APP_TELEMETRY_CONFIG } from '../../constants/telemetry'

const State = getState()

const TELEMETRY_APP_NAME = 'PulseSync'
const TELEMETRY_STATE_FILE = 'app-telemetry-state.json'
const EVENT_APP_INSTALL = 'app.install'
const EVENT_APP_START = 'app.start'
const EVENT_APP_HEARTBEAT = 'app.heartbeat'

type BaseTelemetryPayload = {
    install_id: string
    ts: string
    platform: NodeJS.Platform
    arch: string
    app_name: string
    app_version: string
}

type FeatureSnapshotPayload = BaseTelemetryPayload & {
    metric_type: 'app'
    features: Record<string, unknown>
}

type TelemetryState = {
    install_id?: string
    install_event_sent?: boolean
    last_heartbeat_at_ms?: number
    last_sent_features?: Record<string, unknown>
    last_features_sent_at_ms?: number
}

let heartbeatTimer: NodeJS.Timeout | null = null
let heartbeatStopped = false
let heartbeatInFlight = false
let teardownBound = false

function getMetricsBaseUrl(): string {
    return APP_TELEMETRY_CONFIG.baseUrl.trim().replace(/\/+$/u, '')
}

function getMetricsApiKey(): string | null {
    const normalized = APP_TELEMETRY_CONFIG.apiKey.trim()
    return normalized.length > 0 ? normalized : null
}

function getTelemetryStatePath(): string {
    return path.join(app.getPath('userData'), TELEMETRY_STATE_FILE)
}

async function ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true })
}

async function readJsonSafe(filePath: string): Promise<TelemetryState | null> {
    try {
        const raw = await fs.readFile(filePath, 'utf8')
        return JSON.parse(raw) as TelemetryState
    } catch {
        return null
    }
}

async function writeJsonAtomic(filePath: string, data: TelemetryState): Promise<void> {
    await ensureDir(path.dirname(filePath))

    const tempPath = `${filePath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(data), 'utf8')

    try {
        await fs.rename(tempPath, filePath)
    } catch {
        await fs.copyFile(tempPath, filePath)
        await fs.unlink(tempPath).catch(() => undefined)
    }
}

async function getOrCreateInstallId(statePath: string): Promise<{ state: TelemetryState; installId: string; isNew: boolean }> {
    const state = (await readJsonSafe(statePath)) || {}
    if (typeof state.install_id === 'string' && state.install_id.length > 10) {
        return { state, installId: state.install_id, isNew: false }
    }

    const installId = randomUUID()
    const nextState: TelemetryState = {
        ...state,
        install_id: installId,
    }
    await writeJsonAtomic(statePath, nextState)
    return { state: nextState, installId, isNew: true }
}

function nowMs(): number {
    return Date.now()
}

function shouldSendHeartbeat(lastSentAtMs: number | undefined, intervalMs: number): boolean {
    if (!lastSentAtMs || typeof lastSentAtMs !== 'number') {
        return true
    }

    return nowMs() - lastSentAtMs >= intervalMs
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneFeatureTree(value: unknown): Record<string, unknown> {
    if (!isPlainObject(value)) {
        return {}
    }

    const clone: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
        clone[key] = isPlainObject(nestedValue) ? cloneFeatureTree(nestedValue) : nestedValue
    }
    return clone
}

function areFeatureTreesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true
    }

    if (typeof left === 'boolean' || typeof right === 'boolean') {
        return left === right
    }

    if (!isPlainObject(left) || !isPlainObject(right)) {
        return false
    }

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) {
        return false
    }

    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(right, key)) {
            return false
        }

        if (!areFeatureTreesEqual(left[key], right[key])) {
            return false
        }
    }

    return true
}

function normalizeBooleanFeatureTree(value: unknown): Record<string, unknown> | null {
    if (!isPlainObject(value)) {
        return null
    }

    const normalized: Record<string, unknown> = {}

    for (const [key, nestedValue] of Object.entries(value)) {
        if (typeof nestedValue === 'boolean') {
            normalized[key] = nestedValue
            continue
        }

        const nestedTree = normalizeBooleanFeatureTree(nestedValue)
        if (nestedTree && Object.keys(nestedTree).length > 0) {
            normalized[key] = nestedTree
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : null
}

function buildBasePayload(installId: string): BaseTelemetryPayload {
    return {
        install_id: installId,
        ts: new Date().toISOString(),
        platform: os.platform(),
        arch: os.arch(),
        app_name: TELEMETRY_APP_NAME,
        app_version: app.getVersion(),
    }
}

function buildFeatureSnapshot(): Record<string, unknown> {
    const enabledTheme = State.get('addons.theme')
    const enabledScripts = State.get('addons.scripts')

    return {
        settings: {
            autoStartInTray: Boolean(State.get('settings.autoStartInTray')),
            autoStartMusic: Boolean(State.get('settings.autoStartMusic')),
            autoStartApp: Boolean(State.get('settings.autoStartApp')),
            hardwareAcceleration: Boolean(State.get('settings.hardwareAcceleration')),
            deletePextAfterImport: Boolean(State.get('settings.deletePextAfterImport')),
            closeAppInTray: Boolean(State.get('settings.closeAppInTray')),
            devSocket: Boolean(State.get('settings.devSocket')),
            askSavePath: Boolean(State.get('settings.askSavePath')),
            saveAsMp3: Boolean(State.get('settings.saveAsMp3')),
            showModModalAfterInstall: Boolean(State.get('settings.showModModalAfterInstall')),
            saveWindowPositionOnRestart: Boolean(State.get('settings.saveWindowPositionOnRestart')),
            saveWindowDimensionsOnRestart: Boolean(State.get('settings.saveWindowDimensionsOnRestart')),
            musicReinstalled: Boolean(State.get('settings.musicReinstalled')),
        },
        addons: {
            customThemeEnabled: typeof enabledTheme === 'string' && enabledTheme.trim().length > 0 && enabledTheme !== 'Default',
            scriptsEnabled: Array.isArray(enabledScripts) && enabledScripts.length > 0,
        },
        mod: {
            installed: Boolean(State.get('mod.installed')),
            updated: Boolean(State.get('mod.updated')),
        },
    }
}

async function postTelemetry(pathname: string, payload: Record<string, unknown>, apiKey: string): Promise<void> {
    const response = await fetch(`${getMetricsBaseUrl()}${pathname}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(APP_TELEMETRY_CONFIG.timeoutMs),
    })

    if (response.ok) {
        return
    }

    const responseText = await response.text().catch(() => '')
    throw new Error(`Telemetry request failed with ${response.status}${responseText ? `: ${responseText}` : ''}`)
}

async function sendEvent(installId: string, event: string, apiKey: string): Promise<void> {
    await postTelemetry('/metrics/app', { ...buildBasePayload(installId), event }, apiKey)
}

async function sendFeatureSnapshotIfChanged(
    statePath: string,
    state: TelemetryState,
    installId: string,
    apiKey: string,
): Promise<TelemetryState> {
    const normalizedFeatures = normalizeBooleanFeatureTree(buildFeatureSnapshot())
    if (!normalizedFeatures) {
        return state
    }

    if (areFeatureTreesEqual(state.last_sent_features, normalizedFeatures)) {
        logger.main.debug('Skipping app feature snapshot: no changes detected')
        return state
    }

    const payload: FeatureSnapshotPayload = {
        ...buildBasePayload(installId),
        metric_type: 'app',
        features: normalizedFeatures,
    }

    await postTelemetry('/metrics/features', payload, apiKey)

    const nextState: TelemetryState = {
        ...state,
        last_sent_features: cloneFeatureTree(normalizedFeatures),
        last_features_sent_at_ms: nowMs(),
    }
    await writeJsonAtomic(statePath, nextState)
    return nextState
}

async function trySendHeartbeatOnce(statePath: string, installId: string, apiKey: string): Promise<void> {
    if (heartbeatInFlight) {
        return
    }

    heartbeatInFlight = true

    try {
        const state = (await readJsonSafe(statePath)) || {}
        if (!shouldSendHeartbeat(state.last_heartbeat_at_ms, APP_TELEMETRY_CONFIG.heartbeatIntervalMs)) {
            return
        }

        await sendEvent(installId, EVENT_APP_HEARTBEAT, apiKey)

        const nextState: TelemetryState = {
            ...state,
            last_heartbeat_at_ms: nowMs(),
        }
        await writeJsonAtomic(statePath, nextState)
    } catch (error) {
        logger.main.warn('Failed to send app heartbeat:', error)
    } finally {
        heartbeatInFlight = false
    }
}

function stopHeartbeatScheduler(): void {
    heartbeatStopped = true
    if (heartbeatTimer) {
        clearTimeout(heartbeatTimer)
        heartbeatTimer = null
    }
}

function scheduleNextHeartbeat(statePath: string, installId: string, apiKey: string): void {
    if (heartbeatStopped) {
        return
    }

    if (heartbeatTimer) {
        clearTimeout(heartbeatTimer)
    }

    heartbeatTimer = setTimeout(async () => {
        await trySendHeartbeatOnce(statePath, installId, apiKey)
        scheduleNextHeartbeat(statePath, installId, apiKey)
    }, APP_TELEMETRY_CONFIG.heartbeatIntervalMs)
}

function bindTeardownOnce(): void {
    if (teardownBound) {
        return
    }

    teardownBound = true
    app.on('before-quit', stopHeartbeatScheduler)
    app.on('quit', stopHeartbeatScheduler)
    process.on('exit', stopHeartbeatScheduler)
    process.on('SIGINT', stopHeartbeatScheduler)
    process.on('SIGTERM', stopHeartbeatScheduler)
}

export async function sendAppStartupTelemetry(): Promise<void> {
    const baseUrl = getMetricsBaseUrl()
    const apiKey = getMetricsApiKey()
    if (!baseUrl || !apiKey) {
        logger.main.debug('App telemetry disabled: telemetry config is incomplete')
        return
    }

    try {
        await app.whenReady()
        bindTeardownOnce()

        const statePath = getTelemetryStatePath()
        const { state, installId, isNew } = await getOrCreateInstallId(statePath)

        let nextState = state

        if (isNew && !state.install_event_sent) {
            await sendEvent(installId, EVENT_APP_INSTALL, apiKey)
            nextState = {
                ...nextState,
                install_event_sent: true,
            }
            await writeJsonAtomic(statePath, nextState)
        }

        await sendEvent(installId, EVENT_APP_START, apiKey)
        nextState = await sendFeatureSnapshotIfChanged(statePath, nextState, installId, apiKey)
        await trySendHeartbeatOnce(statePath, installId, apiKey)
        scheduleNextHeartbeat(statePath, installId, apiKey)
    } catch (error) {
        logger.main.warn('App telemetry bootstrap failed:', error)
    }
}
