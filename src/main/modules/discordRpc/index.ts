import { ipcMain } from 'electron'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'
import { Client } from '@xhayper/discord-rpc'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
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

const ACTIVITY_THROTTLE_MS = 3000

let previousActivity: SetActivity | undefined
let pendingActivity: SetActivity | undefined

let reconnectTimeout: ReturnType<typeof setTimeout> | undefined
let isReconnecting = false
let reconnectAttempts = 0
const baseBackoffMs = 5000
const maxBackoffMs = 60000
const connectTimeoutMs = 15000

let clientId: string
let client: Client | null
let changeId = false
export let rpcConnected = false
export let isConnecting = false
let connectGeneration = 0
let connectTimeout: ReturnType<typeof setTimeout> | undefined

const activityThrottler = new Throttler<SetActivity>(ACTIVITY_THROTTLE_MS, activity => {
    try {
        client?.user?.setActivity(activity).catch(async e => {
            const msg = await handleRpcError(e as any)
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: msg || t('main.discordRpc.activitySetError'),
                type: 'error',
            })
        })
    } catch (e: any) {
        logger.discordRpc.error(e.message)
    } finally {
        previousActivity = activity
    }
})

function computeBackoffDelay() {
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
        if (compareActivities(previousActivity, activity)) return true
        previousActivity = activity
        activityThrottler.schedule(activity)
    } else {
        pendingActivity = activity
        rpc_connect()
    }
})

ipcMain.on(MainEvents.DISCORDRPC_DISCORDRPC, (event, val) => {
    setRpcStatus(val)
})

ipcMain.on(MainEvents.DISCORDRPC_RESET_ACTIVITY, () => {
    previousActivity = undefined
    pendingActivity = undefined
    activityThrottler.clear()
})

ipcMain.on(MainEvents.DISCORDRPC_CLEARSTATE, () => {
    pendingActivity = undefined
    activityThrottler.clear()
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
    clientId = customId.length > 0 ? customId : config.CLIENT_ID
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
        startReconnectLoop(5000)
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
        startReconnectLoop()
    })

    clearConnectTimeout()
    connectTimeout = setTimeout(() => {
        if (myGeneration !== connectGeneration) return
        if (!rpcConnected) {
            logger.discordRpc.warn('rpc_connect timeout, retrying')
            isConnecting = false
            startReconnectLoop()
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
            client?.user?.setActivity(pendingActivity).catch(async e => {
                const msg = await handleRpcError(e as any)
                mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                    message: msg || t('main.discordRpc.activitySetError'),
                    type: 'error',
                })
            })
            previousActivity = pendingActivity
            activityThrottler.markJustSent()
            pendingActivity = undefined
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
        startReconnectLoop()
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
        startReconnectLoop()
    })

    client.on('close', () => {
        if (myGeneration !== connectGeneration) return
        clearConnectTimeout()
        isConnecting = false
        rpcConnected = false
        previousActivity = undefined
        logger.discordRpc.info('Connection closed')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: t('main.discordRpc.connectionClosed'), type: 'info' })
        startReconnectLoop()
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
        if (!rpcConnected) {
            rpc_connect()
        }
    } else {
        activityThrottler.clear()
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
