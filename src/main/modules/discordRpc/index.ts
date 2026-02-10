import { ipcMain } from 'electron'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { Client } from '@xhayper/discord-rpc'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import { CUSTOM_RPC_ERROR_CODE, RPC_ERROR_CODE } from '@xhayper/discord-rpc/dist/structures/Transport'
import logger from '../logger'
import { updateTray } from '../tray'
import { mainWindow } from '../createWindow'
import { getState } from '../state'
import { config } from './config'
import { DiscordState } from './types/rpcTypes'
import { readDiscord } from './state'
import { isTimeoutErrorMessage, handleRpcError } from './errors'
import { compareActivities } from './activityCompare'
import Throttler from './throttler'
import { t } from '../../i18n'

const State = getState()

const ACTIVITY_THROTTLE_MS = 2000
const ACTIVITY_TIMEOUT_MS = 5000
const ACTIVITY_RATE_LIMIT_BACKOFF_MS = 15000

let previousActivity: SetActivity | undefined
let pendingActivity: SetActivity | undefined

let reconnectTimeout: ReturnType<typeof setTimeout> | undefined
let isReconnecting = false
let reconnectAttempts = 0
const baseBackoffMs = 3000
const maxBackoffMs = 30000
const connectTimeoutMs = 10000
const fastRetryDelayMs = 2000
const fastRetryAttempts = 3

let clientId: string
let client: Client | null
let changeId = false
export let rpcConnected = false
export let isConnecting = false
let connectGeneration = 0
let connectTimeout: ReturnType<typeof setTimeout> | undefined
let activityCooldownUntil = 0
let activityCooldownTimer: ReturnType<typeof setTimeout> | undefined

const activityThrottler = new Throttler<SetActivity>(ACTIVITY_THROTTLE_MS, activity => {
    void sendActivity(activity)
})

function computeBackoffDelay() {
    if (reconnectAttempts < fastRetryAttempts) {
        return fastRetryDelayMs
    }
    const exp = Math.min(maxBackoffMs, Math.floor(baseBackoffMs * Math.pow(2, reconnectAttempts)))
    const jitter = Math.floor(Math.random() * Math.max(500, Math.floor(exp / 4)))
    return exp + jitter
}

function stopReconnectLoop() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = undefined
    }
    isReconnecting = false
}

function clearConnectTimeout() {
    if (connectTimeout) {
        clearTimeout(connectTimeout)
        connectTimeout = undefined
    }
}

function resolveDefaultClientId() {
    const lang = String(State.get('discordRpc.statusLanguage') || 'en').toLowerCase()
    const preferRu = lang.startsWith('ru')
    const fallback = config.CLIENT_ID || config.ENG_CLIENT_ID || config.RU_CLIENT_ID || ''
    const selected = preferRu ? config.RU_CLIENT_ID : config.ENG_CLIENT_ID
    return (selected && String(selected).length > 0 ? selected : fallback) || ''
}

function clearActivityCooldownTimer() {
    if (activityCooldownTimer) {
        clearTimeout(activityCooldownTimer)
        activityCooldownTimer = undefined
    }
}

function isRateLimitError(error: any) {
    const code = error?.code
    if (code === RPC_ERROR_CODE.RATE_LIMITED) return true
    const msg = String(error?.message ?? '')
    return /rate\s*limit|ratelimited/i.test(msg)
}

function isConnectionError(error: any) {
    const code = error?.code
    if (
        code === CUSTOM_RPC_ERROR_CODE.CONNECTION_ENDED ||
        code === CUSTOM_RPC_ERROR_CODE.CONNECTION_TIMEOUT ||
        code === CUSTOM_RPC_ERROR_CODE.COULD_NOT_CONNECT ||
        code === CUSTOM_RPC_ERROR_CODE.COULD_NOT_FIND_CLIENT ||
        code === RPC_ERROR_CODE.NO_CONNECTION_FOUND
    ) {
        return true
    }
    const msg = String(error?.message ?? '')
    return /connection.*(ended|timed out)|could not connect|no connection|socket|pipe|ECONNRESET|ECONNREFUSED|EPIPE|closed by discord/i.test(
        msg
    )
}

function scheduleReconnect(activity: SetActivity, reason: string) {
    if (!State.get('discordRpc.status')) return
    logger.discordRpc.info(reason)
    pendingActivity = activity
    previousActivity = undefined
    rpcConnected = false
    isConnecting = false
    startReconnectLoop(fastRetryDelayMs)
}

function scheduleActivityCooldown(activity: SetActivity, reason: string, backoffMs: number) {
    const now = Date.now()
    activityCooldownUntil = Math.max(activityCooldownUntil, now + backoffMs)
    pendingActivity = activity
    clearActivityCooldownTimer()
    logger.discordRpc.warn(reason)
    const delay = activityCooldownUntil - now
    activityCooldownTimer = setTimeout(() => {
        activityCooldownTimer = undefined
        if (!rpcConnected || !client || !client.user) return
        const next = pendingActivity
        pendingActivity = undefined
        if (next) {
            void sendActivity(next)
        }
    }, Math.max(0, delay))
}

async function sendActivity(activity: SetActivity): Promise<boolean> {
    if (!client || !client.user) {
        scheduleReconnect(activity, 'RPC client missing during activity update')
        return false
    }
    if (!client.isConnected) {
        scheduleReconnect(activity, 'RPC transport not connected during activity update')
        return false
    }
    const now = Date.now()
    if (activityCooldownUntil > now) {
        scheduleActivityCooldown(activity, 'Activity update rate-limited, retrying later', activityCooldownUntil - now)
        return false
    }
    try {
        await Promise.race([
            client.user.setActivity(activity),
            new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('setActivity timed out')), ACTIVITY_TIMEOUT_MS)
            ),
        ])
        previousActivity = activity
        return true
    } catch (e: any) {
        const msg = await handleRpcError(e as any)
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
            message: msg || t('main.discordRpc.activitySetError'),
            type: 'error',
        })
        if (isConnectionError(e)) {
            scheduleReconnect(activity, 'Activity update failed, reconnecting')
        } else if (isRateLimitError(e)) {
            scheduleActivityCooldown(
                activity,
                'Activity update rate-limited by Discord RPC, backing off',
                ACTIVITY_RATE_LIMIT_BACKOFF_MS
            )
        } else {
            previousActivity = activity
        }
        return false
    }
}

function startReconnectLoop(customDelayMs?: number) {
    if (isReconnecting) return
    isReconnecting = true
    const attemptReconnect = async () => {
        if (!State.get('discordRpc.status')) {
            stopReconnectLoop()
            return
        }
        clearConnectTimeout()
        isConnecting = false
        if (client) {
            try {
                await client.destroy()
                client.removeAllListeners()
                client = null
            } catch (e: any) {
                logger.discordRpc.error('Error destroying client during reconnect: ' + e?.message)
                client = null
            }
        }
        previousActivity = undefined
        rpcConnected = false
        rpc_connect()
        const delay = customDelayMs ?? computeBackoffDelay()
        reconnectTimeout = setTimeout(() => {
            if (!rpcConnected) {
                reconnectAttempts++
                attemptReconnect()
            } else {
                stopReconnectLoop()
            }
        }, delay)
    }
    attemptReconnect()
}

ipcMain.on(MainEvents.DISCORDRPC_SETSTATE, (event, activity: SetActivity) => {
    if (!State.get('discordRpc.status')) return
    if (rpcConnected && client) {
        if (!client.isConnected) {
            scheduleReconnect(activity, 'RPC transport not connected, forcing reconnect')
            return
        }
        if (compareActivities(previousActivity, activity)) return true
        previousActivity = activity
        activityThrottler.schedule(activity)
    } else {
        pendingActivity = activity
        if (!isReconnecting && !isConnecting) {
            rpc_connect()
        }
    }
})

ipcMain.on(MainEvents.DISCORDRPC_DISCORDRPC, (event, val) => {
    setRpcStatus(val)
})

ipcMain.on(MainEvents.DISCORDRPC_RESET_ACTIVITY, () => {
    previousActivity = undefined
    pendingActivity = undefined
    activityThrottler.clear()
    clearActivityCooldownTimer()
    activityCooldownUntil = 0
})

ipcMain.on(MainEvents.DISCORDRPC_CLEARSTATE, () => {
    pendingActivity = undefined
    previousActivity = undefined
    activityThrottler.clear()
    clearActivityCooldownTimer()
    activityCooldownUntil = 0
    if (rpcConnected && client) {
        client.user?.clearActivity().catch(async e => {
            const msg = await handleRpcError(e as any)
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: msg || t('main.discordRpc.activityClearError'),
                type: 'error',
            })
        })
    }
})

async function rpc_connect() {
    if (isConnecting) {
        logger.discordRpc.info('rpc_connect in progress, skipping duplicate call')
        return
    }
    if (!State.get('discordRpc.status')) {
        logger.discordRpc.info('discordRpc.status == false, skipping rpc_connect')
        isConnecting = false
        return
    }
    isConnecting = true
    const myGeneration = ++connectGeneration
    logger.discordRpc.info('Starting rpc_connect(), gen=' + myGeneration)
    if (rpcConnected && client) {
        isConnecting = false
        return
    }
    if (client) {
        try {
            if (client.user) {
                await Promise.race([
                    client.user.clearActivity(),
                    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('clearActivity timed out')), 5000)),
                ])
            }
        } catch (e: any) {
            logger.discordRpc.error('Error clearing activity: ' + e?.message)
        } finally {
            try {
                await client.destroy()
                client.removeAllListeners()
                client = null
            } catch (e: any) {
                logger.discordRpc.error('Error destroying client: ' + e?.message)
                client = null
            }
        }
    }

    const customId = (State.get('discordRpc.appId') || '') as string
    const defaultId = resolveDefaultClientId()
    clientId = customId.length > 0 ? customId : defaultId
    logger.discordRpc.info('Using clientId: ' + clientId)
    client = new Client({
        clientId,
        transport: { type: 'ipc' },
    })

    const discordState = await readDiscord()
    if (discordState !== DiscordState.SUCCESS) {
        logger.discordRpc.info(`Discord state ${discordState}. Next retry`)
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
            message: t('main.discordRpc.stateRetry', { state: t(`main.discordRpc.states.${discordState}`) }),
            type: 'info',
        })
        isConnecting = false
        startReconnectLoop(3000)
        return
    }

    client.login().catch(async e => {
        if (myGeneration !== connectGeneration) return
        clearConnectTimeout()
        const msg = await handleRpcError(e as any)
        logger.discordRpc.error('login error: ' + msg)
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
            message: msg || t('main.discordRpc.connectError'),
            type: 'error',
        })
        const hasCustom = (State.get('discordRpc.appId') || '').length > 0
        const reserve = config.RESERVE_CLIENT_ID
        const isTimeout = isTimeoutErrorMessage((e as any)?.message)
        if (isTimeout && !hasCustom && reserve && String(reserve).length > 0 && reserve !== clientId) {
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: t('main.discordRpc.timeoutFallback'),
                type: 'info',
            })
            isConnecting = false
            updateAppId(String(reserve))
            return
        }
        isConnecting = false
        startReconnectLoop(fastRetryDelayMs)
    })

    clearConnectTimeout()
    connectTimeout = setTimeout(() => {
        if (myGeneration !== connectGeneration) return
        if (!rpcConnected) {
            logger.discordRpc.warn('rpc_connect timeout, retrying')
            isConnecting = false
            startReconnectLoop(fastRetryDelayMs)
        }
    }, connectTimeoutMs)

    client.on('ready', () => {
        if (myGeneration !== connectGeneration) return
        clearConnectTimeout()
        isConnecting = false
        rpcConnected = true
        reconnectAttempts = 0
        pendingActivity = previousActivity ?? pendingActivity
        previousActivity = undefined
        if (changeId) changeId = false
        stopReconnectLoop()
        logger.discordRpc.info('Connection established')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: t('main.discordRpc.connected'), type: 'success' })
        if (pendingActivity) {
            const activity = pendingActivity
            pendingActivity = undefined
            void sendActivity(activity).then(sent => {
                if (sent) {
                    activityThrottler.markJustSent()
                }
            })
        }
    })

    client.on('disconnected', () => {
        if (myGeneration !== connectGeneration) return
        clearConnectTimeout()
        isConnecting = false
        rpcConnected = false
        pendingActivity = previousActivity ?? pendingActivity
        previousActivity = undefined
        logger.discordRpc.info('Disconnected')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: t('main.discordRpc.disconnected'), type: 'info' })
        startReconnectLoop(fastRetryDelayMs)
    })

    client.on('error', async e => {
        if (myGeneration !== connectGeneration) return
        clearConnectTimeout()
        isConnecting = false
        if ((e as any)?.name === 'Could not connect') {
            rpcConnected = false
        }
        pendingActivity = previousActivity ?? pendingActivity
        previousActivity = undefined
        const msg = await handleRpcError(e as any)
        logger.discordRpc.error('Error: ' + msg)
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: msg || t('main.discordRpc.genericConnectError'), type: 'error' })
        const hasCustom = (State.get('discordRpc.appId') || '').length > 0
        const reserve = config.RESERVE_CLIENT_ID
        const isTimeout = isTimeoutErrorMessage((e as any)?.message)
        if (isTimeout && !hasCustom && reserve && String(reserve).length > 0 && reserve !== clientId) {
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: t('main.discordRpc.timeoutFallback'),
                type: 'info',
            })
            updateAppId(String(reserve))
            return
        }
        startReconnectLoop(fastRetryDelayMs)
    })

    client.on('close', () => {
        if (myGeneration !== connectGeneration) return
        clearConnectTimeout()
        isConnecting = false
        rpcConnected = false
        previousActivity = undefined
        logger.discordRpc.info('Connection closed')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: t('main.discordRpc.connectionClosed'), type: 'info' })
        startReconnectLoop(fastRetryDelayMs)
    })
}

function updateAppId(newAppId: string) {
    changeId = true
    State.set('discordRpc.appId', newAppId || '')
    if (!client) {
        rpc_connect()
        return
    }
    try {
        client.removeAllListeners()
    } catch {}
    client.user
        ?.clearActivity()
        .then(() => client?.destroy())
        .then(() => {
            client = null
            rpc_connect()
        })
        .catch(async e => {
            const msg = await handleRpcError(e as any)
            logger.discordRpc.error((e as any)?.message, msg)
            client = null
            rpc_connect()
        })
}

export const setRpcStatus = (status: boolean) => {
    logger.discordRpc.info('discordRpc state: ' + status)
    State.set('discordRpc.status', status)
    mainWindow?.webContents?.send(RendererEvents.DISCORD_RPC_STATE, status)
    updateTray()
    if (status) {
        activityThrottler.clear()
        previousActivity = undefined
        stopReconnectLoop()
        clearActivityCooldownTimer()
        activityCooldownUntil = 0
        if (!rpcConnected) {
            rpc_connect()
        }
    } else {
        activityThrottler.clear()
        clearActivityCooldownTimer()
        activityCooldownUntil = 0
        if (rpcConnected && client) {
            client.user
                ?.clearActivity()
                .then(() => {
                    try {
                        client?.removeAllListeners()
                    } catch {}
                    client?.destroy().catch(async e => {
                        const msg = await handleRpcError(e as any)
                        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                            message: msg || t('main.discordRpc.disconnectError'),
                            type: 'error',
                        })
                        logger.discordRpc.error((e as any)?.message, msg)
                    })
                    previousActivity = undefined
                    rpcConnected = false
                    client = null
                    return
                })
                .catch(async e => {
                    const msg = await handleRpcError(e as any)
                    mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                        message: msg || t('main.discordRpc.activityClearError'),
                        type: 'error',
                    })
                })
        }
    }
}

export { rpc_connect, updateAppId }
