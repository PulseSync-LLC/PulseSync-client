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
import { exec } from 'child_process'

enum DiscordState {
    BROWSER = 'Похоже, Discord запущен в браузере. Подключение невозможно.',
    CLOSED = 'Не удалось обнаружить запущенный Discord!',
    RUNNING_WITHOUT_RICH_PRESENCE_ENABLED = 'Discord запущен, но Rich Presence не включён или у вас стоит плагин блокирующий его работу.',
    ADMINISTRATOR = 'Похоже, Discord запущен с правами администратора. Запустите PulseSync с правами администратора.',
    SUCCESS = '',
}
const SET_ACTIVITY_TIMEOUT_MS = 1500
let sendActivityTimeoutId: NodeJS.Timeout = undefined
let previousActivity: SetActivity = undefined

function removeTimestampsFromActivity(activity: any) {
    let copyActivity = JSON.parse(JSON.stringify(activity))
    copyActivity = copyActivity.startTimestamp ? (copyActivity.startTimestamp = 0) : copyActivity
    copyActivity = copyActivity.endTimestamp ? (copyActivity.endTimestamp = 0) : copyActivity
    return copyActivity
}

function serializeActivity(activity: any) {
    return JSON.stringify(activity)
}

function isTimestampsDifferent(activityA: any, activityB: any) {
    const diff =
        Math.abs((activityA.startTimestamp ?? 0) - (activityB.startTimestamp ?? 0)) +
        Math.abs((activityA.endTimestamp ?? 0) - (activityB.endTimestamp ?? 0))
    return diff > 2000
}

function compareActivities(newActivity: any) {
    if (!previousActivity) return false
    return (
        serializeActivity(removeTimestampsFromActivity(newActivity)) ===
            serializeActivity(removeTimestampsFromActivity(previousActivity)) &&
        !isTimestampsDifferent(newActivity, previousActivity)
    )
}

/**
 * Функция проверяет состояние клиента Discord (на Windows) путём:
 * 1. Поиска IPC-каналов.
 * 2. Попытки подключения и проверки прав доступа.
 * 3. Если IPC не найден – проверки списка процессов.
 */
async function checkDiscordState(): Promise<string> {
    const browsers = [
        'chrome.exe',
        'firefox.exe',
        'applicationframehost.exe',
        'opera.exe',
        'iexplore.exe',
        'brave.exe',
        'vivaldi.exe',
    ]

    const discordProcesses = [
        'discord.exe',
        'discordptb.exe',
        'discordcanary.exe',
        'discorddevelopment.exe',
        'vesktop.exe',
    ]

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

    let output: string
    try {
        output = await new Promise<string>((resolve, reject) => {
            exec(`tasklist /V /fi "SESSIONNAME eq Console"`, { encoding: 'utf8' }, (err, stdout) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(stdout)
                }
            })
        })
    } catch {
        return DiscordState.CLOSED
    }

    const lines = output.split('\n').map(line => line.trim().toLowerCase())

    const discordClientRunning = lines.some(line => discordProcesses.some(exe => line.startsWith(exe)))

    if (discordClientRunning) {
        return DiscordState.RUNNING_WITHOUT_RICH_PRESENCE_ENABLED
    } else {
        const discordBrowser = lines.some(line =>
            browsers.some(browser => line.startsWith(browser) && line.includes('discord')),
        )
        if (discordBrowser) {
            return DiscordState.BROWSER
        }
    }
    return DiscordState.CLOSED
}

/**
 * Асинхронная функция обработки ошибок RPC.
 * Если ошибка не покрыта стандартными проверками, дополнительно вызывается checkDiscordState()
 * для получения более точного описания проблемы.
 */
async function handleRpcError(e: Error): Promise<string> {
    const state = await checkDiscordState()
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

async function rpc_connect() {
    if (rpcConnected && client) {
        logger.discordRpc.info('Уже подключено к Discord RPC, повторное подключение не требуется')
        return
    }

    if (client) {
        try {
            await client.user?.clearActivity()
            await client.destroy()
            client.removeAllListeners()
        } catch (e) {
            const msg = await handleRpcError(e)
            logger.discordRpc.error('Ошибка очистки активности перед созданием нового: ' + msg)
            mainWindow.webContents.send('rpc-log', { message: 'Ошибка удаления активности', type: 'error' })
        }
    }

    const customId = store.get('discordRpc.appId')
    clientId = customId.length > 0 ? customId : config.CLIENT_ID

    client = new Client({
        clientId,
        transport: { type: 'ipc' },
    })

    const discordState = await checkDiscordState()
    if (discordState !== DiscordState.SUCCESS) {
        logger.discordRpc.error('Discord state error: ' + discordState)
        mainWindow.webContents.send('rpc-log', {
            message: discordState || 'Ошибка подключения к Discord RPC',
            type: 'error',
        })
        return
    }

    client.login().catch(async e => {
        const msg = await handleRpcError(e)
        logger.discordRpc.error("login error: " + msg)
        mainWindow.webContents.send('rpc-log', {
            message: msg || 'Ошибка подключения к Discord RPC',
            type: 'error',
        })
    })

    client.on('ready', () => {
        rpcConnected = true
        if (changeId) changeId = false
        logger.discordRpc.info('discordRpc state: connected')
        mainWindow.webContents.send('rpc-log', {
            message: 'Успешное подключение',
            type: 'success',
        })
    })

    client.on('disconnected', () => {
        rpcConnected = false
        logger.discordRpc.info('discordRpc state: disconnected')
        mainWindow.webContents.send('rpc-log', {
            message: 'Отключение RPC',
            type: 'info',
        })
    })

    client.on('error', async e => {
        if (e.name === 'Could not connect') {
            rpcConnected = false
        }
        const msg = await handleRpcError(e)
        logger.discordRpc.error('discordRpc state: error - ' + msg)
        mainWindow.webContents.send('rpc-log', {
            message: msg || 'Ошибка подключения',
            type: 'error',
        })
    })

    client.on('close', () => {
        rpcConnected = false
        logger.discordRpc.info('discordRpc state: closed')
        mainWindow.webContents.send('rpc-log', {
            message: 'Закрытие соединения',
            type: 'info',
        })
    })
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
