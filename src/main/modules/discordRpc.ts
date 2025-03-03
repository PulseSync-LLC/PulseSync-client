import { ipcMain } from 'electron'
import { Client, CUSTOM_RPC_ERROR_CODE } from '@xhayper/discord-rpc'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import { store } from './storage'
import logger from './logger'
import config from '../../config.json'
import { mainWindow } from '../../index'
import { updateTray } from './tray'
import { RPCError } from '@xhayper/discord-rpc/dist/utils/RPCError'

let clientId
let client: Client

let changeId = false
let rpcConnected = false

function handleRpcError(e: Error): string {
    if (e instanceof RPCError) {
        switch (e.code) {
            case CUSTOM_RPC_ERROR_CODE.COULD_NOT_CONNECT:
                return 'Ошибка IPC. Проверьте, что Discord запущен.'
            case CUSTOM_RPC_ERROR_CODE.CONNECTION_ENDED:
                return 'Соединение с IPC потеряно. Возможно, Discord закрыт.'
            case CUSTOM_RPC_ERROR_CODE.CONNECTION_TIMEOUT:
                return 'Тайм-аут подключения. Перезапустите приложение и Discord с одинаковыми правами.'
            default:
                return 'Неизвестная ошибка RPC.'
        }
    }
    const sysCode = (e as any).code as string | undefined
    if (sysCode) {
        switch (sysCode) {
            case 'ENOENT':
                return 'IPC не найден. Запустите Discord.'
            case 'ECONNREFUSED':
                return 'Подключение отклонено. Возможно, что-то блокирует соединение.'
            case 'EACCES':
                return 'Недостаточно прав. Запустите с одинаковыми правами.'
            default:
                return `Ошибка: ${sysCode}. ${e.message}`
        }
    }
    return e.message.includes('Could not connect')
        ? 'Не удалось подключиться к IPC. Запустите Discord.'
        : `RPC ошибка: ${e.message}`
}

ipcMain.on('discordrpc-setstate', (event, activity: SetActivity) => {
    if (rpcConnected && client.isConnected) {
        client.user?.setActivity(activity).catch(e => {
            const msg = handleRpcError(e)
            logger.debug.error(e.message, msg)
            mainWindow.webContents.send('rpc-log', {
                message: msg || 'Ошибка установки активности',
                type: 'error',
            })
        })
    } else if (!changeId) {
        rpc_connect()
    }
})

ipcMain.on('discordrpc-discordRpc', (event, val) => {
    setRpcStatus(val)
})

function updateAppId(newAppId: string) {
    if (newAppId === config.CLIENT_ID) return
    changeId = true
    store.set('discordRpc.appId', newAppId)
    client.removeAllListeners()
    client
        .destroy()
        .then(() => {
            rpc_connect()
        })
        .catch(e => {
            const msg = handleRpcError(e)
            logger.discordRpc.error(e.message, msg)
        })
}

ipcMain.on('discordrpc-clearstate', () => {
    if (rpcConnected) client.user?.clearActivity()
})

async function rpc_connect() {
    if (client) {
        client.destroy().catch(e => {
            const msg = handleRpcError(e)
            logger.discordRpc.error('Ошибка уничтожения клиента перед созданием нового: ' + msg)
            mainWindow.webContents.send('rpc-log', {
                message: 'Ошибка удаления активности',
                type: 'error',
            })
        })
        client.removeAllListeners()
    }

    const customId = store.get('discordRpc.appId')
    clientId = customId.length > 0 ? customId : config.CLIENT_ID

    client = new Client({
        clientId,
        transport: { type: 'ipc' },
    })

    client.login().catch(e => {
        const msg = handleRpcError(e)
        logger.debug.error(e.message, msg)
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
            message: 'Отключение',
            type: 'info',
        })
    })

    client.on('error', e => {
        rpcConnected = false
        const msg = handleRpcError(e)
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

export const setRpcStatus = (status: boolean) => {
    logger.discordRpc.info('discordRpc state: ' + status)
    store.set('discordRpc.status', status)
    mainWindow.webContents.send('discordRpcState', status)
    updateTray()
    if (status && !rpcConnected) {
        rpc_connect()
    } else {
        client.removeAllListeners()
        client.destroy().catch(e => {
            const msg = handleRpcError(e)
            mainWindow.webContents.send('rpc-log', {
                message: msg || 'Ошибка обновления клиента',
                type: 'error',
            })
            logger.discordRpc.error(e.message, msg)
        })
        rpcConnected = false
    }
}
export { rpc_connect, updateAppId }
