import { ipcMain } from 'electron'
import { Client } from '@xhayper/discord-rpc'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import { store } from './storage'
import logger from './logger'
import config from '../../config.json'
import { mainWindow } from '../../index'
import { updateTray } from './tray'
import * as fs from 'node:fs'
import * as net from 'net'
import { promisify } from 'util'
import { exec } from 'child_process'

enum DiscordState {
    CLOSED = 'Не удалось обнаружить запущенный Discord!',
    ADMINISTRATOR = 'Похоже, Discord запущен с правами администратора. Запустите PulseSync с правами администратора.',
    SNAP = "Похоже, Discord запущен из пакета Snap. Это, скорее всего, помешает приложению подключиться к RPC",
    FLATPAK = "Похоже, Discord запущен из пакета Flatpak. Это, скорее всего, помешает приложению подключится к RPC",
    SUCCESS = '',
}
const execAsync = promisify(exec);
const SET_ACTIVITY_TIMEOUT_MS = 1500
let sendActivityTimeoutId: NodeJS.Timeout = undefined
let previousActivity: SetActivity = undefined

let reconnectTimeout: NodeJS.Timeout = undefined

export async function readDiscord(): Promise<DiscordState> {
    const platform = process.platform;

    if (platform === 'win32') {
        return await checkDiscordStateWin();
    } else if (platform === 'linux') {
        return await checkDiscordStateLinux();
    } else if (platform === 'darwin') {
        return await checkDiscordStateMac();
    } else {
        return DiscordState.CLOSED;
    }
}
function removeTimestampsFromActivity(activity: any) {
    let copyActivity = JSON.parse(JSON.stringify(activity))
    if (copyActivity.startTimestamp) {
        copyActivity.startTimestamp = 0
    }
    if (copyActivity.endTimestamp) {
        copyActivity.endTimestamp = 0
    }
    return copyActivity
}

function serializeActivity(activity: any) {
    return JSON.stringify(activity)
}

function isTimestampsDifferent(activityA: any, activityB: any) {
    const diff =
        Math.abs((activityA.startTimestamp ?? 0) - (activityB.startTimestamp ?? 0)) +
        Math.abs((activityA.endTimestamp ?? 0) - (activityB.endTimestamp ?? 0))
    return diff >= 2000
}

function compareActivities(newActivity: any) {
    if (!previousActivity) return false
    return (
        serializeActivity(removeTimestampsFromActivity(newActivity)) === serializeActivity(removeTimestampsFromActivity(previousActivity)) &&
        !isTimestampsDifferent(newActivity, previousActivity)
    )
}

export async function checkDiscordStateLinux(): Promise<DiscordState> {
    try {
        const { stdout } = await execAsync('ps xo user:30,command');
        const lines = stdout
            .split('\n')
            .filter(line => line.toLowerCase().includes('/discord'))
            .join('\n');

        if (!lines.trim()) {
            return DiscordState.CLOSED;
        } else if (lines.toLowerCase().includes('/snap/discord')) {
            return DiscordState.SNAP;
        } else if (lines.toLowerCase().includes('/app/com.discordapp.discord')) {
            return DiscordState.FLATPAK;
        } else {
            return DiscordState.SUCCESS;
        }
    } catch (error) {
        logger.discordRpc.error('Error executing process command:', error);
        return DiscordState.CLOSED;
    }
}

export async function checkDiscordStateMac(): Promise<DiscordState> {
    const clients = [
        "Discord.app",
        "Discord PTB.app",
        "Discord Canary.app",
        "Discord Development.app"
    ];

    try {
        const { stdout } = await execAsync("ps -A");
        const lines = stdout.split('\n');

        const clientNotRunning = lines.every(line =>
            !clients.some(client => line.includes(client))
        );

        if (clientNotRunning) {
            return DiscordState.CLOSED;
        }

        return DiscordState.SUCCESS;
    } catch (error) {
        return DiscordState.CLOSED;
    }
}

async function checkDiscordStateWin(): Promise<DiscordState> {
    const ipcPaths = Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`)
    let ipcPathFound: string | null = null

    for (const ipcPath of ipcPaths) {
        try {
            await fs.promises.access(ipcPath, fs.constants.F_OK)
            ipcPathFound = ipcPath
            break
        } catch {}
    }

    if (ipcPathFound) {
        try {
            await new Promise<void>((resolve, reject) => {
                const client = net.connect(ipcPathFound!, () => {
                    client.end()
                    resolve()
                })
                client.on('error', reject)
            })
        } catch {
            return DiscordState.ADMINISTRATOR
        }

        try {
            await fs.promises.access(ipcPathFound, fs.constants.R_OK | fs.constants.W_OK)
        } catch {
            return DiscordState.ADMINISTRATOR
        }
        return DiscordState.SUCCESS
    }
    return DiscordState.CLOSED
}

/**
 * Асинхронная функция обработки ошибок RPC.
 * Если ошибка не покрыта стандартными проверками, дополнительно вызывается checkDiscordState()
 * для получения более точного описания проблемы.
 */
async function handleRpcError(e: Error): Promise<string> {
    const state = await readDiscord()
    if (state !== DiscordState.SUCCESS) {
        return state
    }
    return e.message.includes('Connection timed out')
        ? 'Тайм-аут подключения. Возможны рейт-лимиты от Discord. Если не показывается активность, то попробуйте снова через 10–15 минут.'
        : e.message
}

let clientId: string
let client: Client

let changeId = false
let rpcConnected = false
let isConnecting = false

ipcMain.on('discordrpc-setstate', (event, activity: SetActivity) => {
    if (rpcConnected && client) {
        if (compareActivities(activity)) return true

        previousActivity = activity
        if (sendActivityTimeoutId) {
            clearTimeout(sendActivityTimeoutId)
            sendActivityTimeoutId = undefined
        }
        sendActivityTimeoutId = setTimeout(() => {
            try {
                client.user?.setActivity(activity).catch(async e => {
                    const msg = await handleRpcError(e)

                    mainWindow.webContents.send('rpc-log', {
                        message: msg || 'Ошибка установки активности',
                        type: 'error',
                    })
                })
            } catch (e) {
                logger.discordRpc.error(e.message)
            }
        }, SET_ACTIVITY_TIMEOUT_MS)
    } else if (!changeId) {
        rpc_connect()
    }
})

ipcMain.on('discordrpc-discordRpc', (event, val) => {
    setRpcStatus(val)
})

ipcMain.on('discordrpc-reset-activity', () => {
    logger.discordRpc.debug('Resetting previous activity due to page reload')
    previousActivity = undefined
})

ipcMain.on('discordrpc-clearstate', () => {
    if (rpcConnected && client) {
        client.user?.clearActivity().catch(async e => {
            const msg = await handleRpcError(e)
            mainWindow.webContents.send('rpc-log', {
                message: msg || 'Ошибка очистки активности',
                type: 'error',
            })
        })
    }
})

function scheduleReconnect() {
    if (store.get('discordRpc.status') && !reconnectTimeout) {
        reconnectTimeout = setTimeout(() => {
            reconnectTimeout = undefined
            rpc_connect()
        }, 3000)
    }
}

function clearActivityWithTimeout(client: Client, timeoutMs: number = 5000): Promise<void> {
    return Promise.race([
        client.user!.clearActivity(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('clearActivity timed out')), timeoutMs)),
    ])
}

async function rpc_connect() {
    if (isConnecting) {
        logger.discordRpc.info('rpc_connect in progress, skipping duplicate call')
        return
    }
    isConnecting = true
    logger.discordRpc.info('Starting rpc_connect()')
    if (rpcConnected && client) {
        logger.discordRpc.info('Already connected, skipping')
        isConnecting = false
        return
    }
    if (client) {
        try {
            if (client.user) {
                await clearActivityWithTimeout(client, 5000)
            }
        } catch (e) {
            logger.discordRpc.error('Error clearing activity: ' + e.message)
        } finally {
            try {
                await client.destroy()
                client.removeAllListeners()
                client = null
            } catch (e) {
                logger.discordRpc.error('Error destroying client: ' + e.message)
            }
        }
    }
    const customId = store.get('discordRpc.appId')
    clientId = customId.length > 0 ? customId : config.CLIENT_ID
    logger.discordRpc.info('Using clientId: ' + clientId)
    client = new Client({
        clientId,
        transport: { type: 'ipc' },
    })
    const discordState = await readDiscord()
    if (discordState !== DiscordState.SUCCESS) {
        logger.discordRpc.error('Discord state error: ' + discordState)
        mainWindow.webContents.send('rpc-log', { message: discordState || 'Ошибка подключения к Discord RPC', type: 'error' })
        scheduleReconnect()
        isConnecting = false
        return
    }
    client.login().catch(async e => {
        const msg = await handleRpcError(e)
        logger.discordRpc.error('login error: ' + msg)
        mainWindow.webContents.send('rpc-log', { message: msg || 'Ошибка подключения к Discord RPC', type: 'error' })
        scheduleReconnect()
    })
    client.on('ready', () => {
        rpcConnected = true
        previousActivity = undefined
        if (changeId) changeId = false
        logger.discordRpc.info('Connection established')
        mainWindow.webContents.send('rpc-log', { message: 'Успешное подключение', type: 'success' })
    })
    client.on('disconnected', () => {
        rpcConnected = false
        previousActivity = undefined
        logger.discordRpc.info('Disconnected')
        mainWindow.webContents.send('rpc-log', { message: 'Отключение RPC', type: 'info' })
        scheduleReconnect()
    })
    client.on('error', async e => {
        if (e.name === 'Could not connect') {
            rpcConnected = false
        }
        previousActivity = undefined
        const msg = await handleRpcError(e)
        logger.discordRpc.error('Error: ' + msg)
        mainWindow.webContents.send('rpc-log', { message: msg || 'Ошибка подключения', type: 'error' })
        scheduleReconnect()
    })
    client.on('close', () => {
        rpcConnected = false
        previousActivity = undefined
        logger.discordRpc.info('Connection closed')
        mainWindow.webContents.send('rpc-log', { message: 'Закрытие соединения', type: 'info' })
        scheduleReconnect()
    })
    isConnecting = false
}

function updateAppId(newAppId: string) {
    if (newAppId === config.CLIENT_ID) return
    changeId = true
    store.set('discordRpc.appId', newAppId)
    client.removeAllListeners()

    client.user
        ?.clearActivity()
        .then(() => {
            return client.destroy()
        })
        .then(() => {
            client = null
            rpc_connect()
        })
        .catch(async e => {
            const msg = await handleRpcError(e)
            logger.discordRpc.error(e.message, msg)
        })
}

export const setRpcStatus = (status: boolean) => {
    logger.discordRpc.info('discordRpc state: ' + status)
    store.set('discordRpc.status', status)
    mainWindow.webContents.send('discordRpcState', status)
    updateTray()

    if (status && !rpcConnected) {
        previousActivity = undefined
        return rpc_connect()
    } else if (!status && rpcConnected && client) {
        client.user
            ?.clearActivity()
            .then(() => {
                client.removeAllListeners()
                client.destroy().catch(async e => {
                    const msg = await handleRpcError(e)
                    mainWindow.webContents.send('rpc-log', {
                        message: msg || 'Ошибка отключения клиента',
                        type: 'error',
                    })
                    logger.discordRpc.error(e.message, msg)
                })
                previousActivity = undefined
                rpcConnected = false
                client = null
                return
            })
            .catch(async e => {
                const msg = await handleRpcError(e)
                mainWindow.webContents.send('rpc-log', {
                    message: msg || 'Ошибка очистки активности',
                    type: 'error',
                })
            })
    }
}
export { rpc_connect, updateAppId }
