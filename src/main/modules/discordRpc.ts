import { ipcMain } from 'electron'
import MainEvents from '../../common/types/mainEvents'
import RendererEvents from '../../common/types/rendererEvents'
import { Client } from '@xhayper/discord-rpc'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import logger from './logger'
import rawConfig from '../../config.json'
import { updateTray } from './tray'
import { promisify } from 'util'
import { exec } from 'child_process'
import { mainWindow } from './createWindow'
import { getState } from './state'
import { isDiscordRunning, isAnyDiscordElevated, isProcessElevated } from './naviveModule'
import path from 'path'

type AppConfig = {
    CLIENT_ID: string
    RESERVE_CLIENT_ID?: string
}
const config = rawConfig as AppConfig

enum DiscordState {
    CLOSED = 'Не удалось обнаружить запущенный Discord!',
    ADMINISTRATOR = 'Похоже, Discord запущен с правами администратора. Запустите PulseSync с правами администратора.',
    SNAP = 'Похоже, Discord запущен из пакета Snap. Это, скорее всего, помешает приложению подключиться к RPC',
    FLATPAK = 'Похоже, Discord запущен из пакета Flatpak. Это, скорее всего, помешает приложению подключится к RPC',
    SUCCESS = '',
}

const State = getState()
const execAsync = promisify(exec)
const SET_ACTIVITY_TIMEOUT_MS = 1500

let sendActivityTimeoutId: ReturnType<typeof setTimeout> | undefined
let previousActivity: SetActivity | undefined
let pendingActivity: SetActivity | undefined

let reconnectTimeout: ReturnType<typeof setTimeout> | undefined
let isReconnecting = false
let reconnectAttempts = 0
const baseBackoffMs = 5000
const maxBackoffMs = 60000

export async function readDiscord(): Promise<DiscordState> {
    const platform = process.platform
    if (platform === 'win32') {
        return await checkDiscordStateWin()
    } else if (platform === 'linux') {
        return await checkDiscordStateLinux()
    } else if (platform === 'darwin') {
        return await checkDiscordStateMac()
    } else {
        return DiscordState.CLOSED
    }
}

function deepClone<T>(obj: T): T {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj))
}

function sortKeys(value: any): any {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {}
        for (const k of Object.keys(value).sort()) out[k] = sortKeys((value as any)[k])
        return out
    }
    return value
}

function normalizeActivityForCompare(activity: any) {
    const copy = deepClone(activity) || {}
    if (copy.startTimestamp) copy.startTimestamp = 0
    if (copy.endTimestamp) copy.endTimestamp = 0
    return sortKeys(copy)
}

function isTimestampsDifferent(activityA: any, activityB: any) {
    const aStart = activityA?.startTimestamp ?? 0
    const bStart = activityB?.startTimestamp ?? 0
    const aEnd = activityA?.endTimestamp ?? 0
    const bEnd = activityB?.endTimestamp ?? 0
    const diff = Math.abs(aStart - bStart) + Math.abs(aEnd - bEnd)
    return diff >= 2000
}

function compareActivities(newActivity: any) {
    if (!previousActivity) return false
    const a = JSON.stringify(normalizeActivityForCompare(newActivity))
    const b = JSON.stringify(normalizeActivityForCompare(previousActivity))
    return a === b && !isTimestampsDifferent(newActivity, previousActivity)
}

export async function checkDiscordStateLinux(): Promise<DiscordState> {
    try {
        const { stdout } = await execAsync('ps xo user:30,command')
        const lines = stdout
            .split('\n')
            .filter(line => line.toLowerCase().includes('/discord'))
            .join('\n')
        if (!lines.trim()) {
            return DiscordState.CLOSED
        } else if (lines.toLowerCase().includes('/snap/discord')) {
            return DiscordState.SNAP
        } else if (lines.toLowerCase().includes('/app/com.discordapp.discord')) {
            return DiscordState.FLATPAK
        } else {
            return DiscordState.SUCCESS
        }
    } catch (error) {
        logger.discordRpc.error('Error executing process command:', error)
        return DiscordState.CLOSED
    }
}

export async function checkDiscordStateMac(): Promise<DiscordState> {
    const clients = ['Discord.app', 'Discord PTB.app', 'Discord Canary.app', 'Discord Development.app']
    try {
        const { stdout } = await execAsync('ps -A')
        const lines = stdout.split('\n')
        const clientNotRunning = lines.every(line => !clients.some(client => line.includes(client)))
        if (clientNotRunning) {
            return DiscordState.CLOSED
        }
        return DiscordState.SUCCESS
    } catch {
        return DiscordState.CLOSED
    }
}

export async function checkDiscordStateWin(): Promise<DiscordState> {
    const running = isDiscordRunning()
    logger.discordRpc.info('Discord running:', running)
    if (!running) {
        return DiscordState.CLOSED
    }
    const elevated = isAnyDiscordElevated()
    logger.discordRpc.info('Discord elevated:', elevated)
    if (elevated) {
        const exeName = path.basename(process.execPath)
        const selfElevated = isProcessElevated(exeName)
        logger.discordRpc.info('Self elevated:', selfElevated)
        if (selfElevated) {
            return DiscordState.SUCCESS
        }
        return DiscordState.ADMINISTRATOR
    }
    return DiscordState.SUCCESS
}

function isTimeoutErrorMessage(msg: string | undefined) {
    if (!msg) return false
    return /timed?\s*out|timeout|ETIMEDOUT/i.test(msg)
}

async function handleRpcError(e: Error): Promise<string> {
    const state = await readDiscord()
    if (state !== DiscordState.SUCCESS) {
        return state
    }
    return isTimeoutErrorMessage(e?.message)
        ? 'Тайм-аут подключения. Возможны рейт-лимиты от Discord. Если не показывается активность, то попробуйте снова через 10–15 минут.'
        : e.message
}

let clientId: string
let client: Client | null
let changeId = false
export let rpcConnected = false
export let isConnecting = false
let connectGeneration = 0

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

function startReconnectLoop(customDelayMs?: number) {
    if (isReconnecting) return
    isReconnecting = true
    const attemptReconnect = async () => {
        if (!State.get('discordRpc.status')) {
            stopReconnectLoop()
            return
        }
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
        if (compareActivities(activity)) return true
        previousActivity = activity
        if (sendActivityTimeoutId) {
            clearTimeout(sendActivityTimeoutId)
            sendActivityTimeoutId = undefined
        }
        sendActivityTimeoutId = setTimeout(() => {
            try {
                client?.user?.setActivity(activity).catch(async e => {
                    const msg = await handleRpcError(e)
                    mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                        message: msg || 'Ошибка установки активности',
                        type: 'error',
                    })
                })
            } catch (e: any) {
                logger.discordRpc.error(e.message)
            }
        }, SET_ACTIVITY_TIMEOUT_MS)
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
    if (sendActivityTimeoutId) {
        clearTimeout(sendActivityTimeoutId)
        sendActivityTimeoutId = undefined
    }
})

ipcMain.on(MainEvents.DISCORDRPC_CLEARSTATE, () => {
    pendingActivity = undefined
    if (sendActivityTimeoutId) {
        clearTimeout(sendActivityTimeoutId)
        sendActivityTimeoutId = undefined
    }
    if (rpcConnected && client) {
        client.user?.clearActivity().catch(async e => {
            const msg = await handleRpcError(e as any)
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: msg || 'Ошибка очистки активности',
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
            message: `${discordState} Следующая попытка через несколько секунд.`,
            type: 'info',
        })
        isConnecting = false
        startReconnectLoop(5000)
        return
    }

    client.login().catch(async e => {
        if (myGeneration !== connectGeneration) return
        const msg = await handleRpcError(e as any)
        logger.discordRpc.error('login error: ' + msg)
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: msg || 'Ошибка подключения к Discord RPC', type: 'error' })
        const hasCustom = (State.get('discordRpc.appId') || '').length > 0
        const reserve = config.RESERVE_CLIENT_ID
        const isTimeout = isTimeoutErrorMessage((e as any)?.message)
        if (isTimeout && !hasCustom && reserve && String(reserve).length > 0 && reserve !== clientId) {
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: 'Тайм-аут подключения. Переключаюсь на резервный App ID.',
                type: 'info',
            })
            isConnecting = false
            updateAppId(String(reserve))
            return
        }
        isConnecting = false
        startReconnectLoop()
    })

    client.on('ready', () => {
        if (myGeneration !== connectGeneration) return
        isConnecting = false
        rpcConnected = true
        reconnectAttempts = 0
        previousActivity = undefined
        if (changeId) changeId = false
        stopReconnectLoop()
        logger.discordRpc.info('Connection established')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: 'Успешное подключение', type: 'success' })
        if (pendingActivity) {
            client?.user?.setActivity(pendingActivity).catch(async e => {
                const msg = await handleRpcError(e as any)
                mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                    message: msg || 'Ошибка установки активности',
                    type: 'error',
                })
            })
            previousActivity = pendingActivity
            pendingActivity = undefined
        }
    })

    client.on('disconnected', () => {
        if (myGeneration !== connectGeneration) return
        rpcConnected = false
        previousActivity = undefined
        logger.discordRpc.info('Disconnected')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: 'Отключение RPC', type: 'info' })
        startReconnectLoop()
    })

    client.on('error', async e => {
        if (myGeneration !== connectGeneration) return
        if ((e as any)?.name === 'Could not connect') {
            rpcConnected = false
        }
        previousActivity = undefined
        const msg = await handleRpcError(e as any)
        logger.discordRpc.error('Error: ' + msg)
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: msg || 'Ошибка подключения', type: 'error' })
        const hasCustom = (State.get('discordRpc.appId') || '').length > 0
        const reserve = config.RESERVE_CLIENT_ID
        const isTimeout = isTimeoutErrorMessage((e as any)?.message)
        if (isTimeout && !hasCustom && reserve && String(reserve).length > 0 && reserve !== clientId) {
            mainWindow?.webContents?.send(RendererEvents.RPC_LOG, {
                message: 'Тайм-аут подключения. Переключаюсь на резервный App ID.',
                type: 'info',
            })
            updateAppId(String(reserve))
            return
        }
        startReconnectLoop()
    })

    client.on('close', () => {
        if (myGeneration !== connectGeneration) return
        rpcConnected = false
        previousActivity = undefined
        logger.discordRpc.info('Connection closed')
        mainWindow?.webContents?.send(RendererEvents.RPC_LOG, { message: 'Закрытие соединения', type: 'info' })
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
        if (sendActivityTimeoutId) {
            clearTimeout(sendActivityTimeoutId)
            sendActivityTimeoutId = undefined
        }
        previousActivity = undefined
        stopReconnectLoop()
        if (!rpcConnected) {
            rpc_connect()
        }
    } else {
        if (sendActivityTimeoutId) {
            clearTimeout(sendActivityTimeoutId)
            sendActivityTimeoutId = undefined
        }
        stopReconnectLoop()
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
                            message: msg || 'Ошибка отключения клиента',
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
                        message: msg || 'Ошибка очистки активности',
                        type: 'error',
                    })
                })
        }
    }
}

export { rpc_connect, updateAppId }
