import { DiscordState } from './types/rpcTypes'
import { promisify } from 'util'
import { exec } from 'child_process'
import logger from '../logger'
import path from 'path'
import { isDiscordRunning, isAnyDiscordElevated, isProcessElevated } from '../nativeModules'

const execAsync = promisify(exec)

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
