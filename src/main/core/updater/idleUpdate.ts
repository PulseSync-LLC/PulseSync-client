import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { app, powerMonitor } from 'electron'

import logger from '../../shared/logger'
import { getMusicSocketForIdleUpdate } from '../httpServer'
import { getYandexMusicAppDataPath, getYandexMusicProcesses } from '../utils/appUtils'

const IDLE_SECONDS = 5 * 60
const CHECK_INTERVAL_MS = 30_000
const MUSIC_EXIT_TIMEOUT_MS = 5000

export function isUserIdle(): boolean {
    return powerMonitor.getSystemIdleTime() >= IDLE_SECONDS
}

async function isModAutoUpdateEnabled(): Promise<boolean> {
    const config = await readFile(join(getYandexMusicAppDataPath(), 'config.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null)
    const enabled = config?.modSettings?.appAutoUpdates?.enableModAutoUpdate
    return Boolean(config && typeof config === 'object' && !Array.isArray(config) && (enabled === undefined || enabled === true))
}

export async function canInstallIdleUpdate(forMod = false): Promise<boolean> {
    if (!isUserIdle()) return false
    const processes = await getYandexMusicProcesses({ strict: true })
    if (!processes.length) return (!forMod || (await isModAutoUpdateEnabled())) && isUserIdle()
    const socket = getMusicSocketForIdleUpdate()
    const status = await socket
        ?.timeout(1500)
        .emitWithAck('GET_IDLE_UPDATE_STATUS')
        .catch(() => null)
    return (
        status?.safe === true &&
        (!forMod || status.modEnabled === true) &&
        socket?.connected === true &&
        processes.some(({ pid }) => pid === status.pid) &&
        isUserIdle()
    )
}

export async function closeMusicForIdleModUpdate(): Promise<{ wasRunning: boolean } | null> {
    if (!isUserIdle()) return null
    const processes = await getYandexMusicProcesses({ strict: true })
    if (!processes.length) {
        if (!(await isModAutoUpdateEnabled())) return null
        const running = await getYandexMusicProcesses({ strict: true })
        return !running.length && isUserIdle() ? { wasRunning: false } : null
    }

    const socket = getMusicSocketForIdleUpdate()
    const status = await socket
        ?.timeout(1500)
        .emitWithAck('GET_IDLE_UPDATE_STATUS')
        .catch(() => null)
    if (status?.safe !== true || status.modEnabled !== true || !isUserIdle() || !processes.some(({ pid }) => pid === status.pid)) return null
    const accepted = await socket
        ?.timeout(1500)
        .emitWithAck('QUIT_FOR_IDLE_MOD_UPDATE', status.pid)
        .catch(() => false)
    if (accepted !== true) return null

    const deadline = performance.now() + MUSIC_EXIT_TIMEOUT_MS
    do {
        if (!(await getYandexMusicProcesses({ strict: true })).length) return { wasRunning: true }
        await delay(250)
    } while (performance.now() < deadline)
    return null
}

export function startIdleUpdateMonitor(install: () => Promise<void>): void {
    if (!app.isPackaged && process.env.PULSESYNC_ENABLE_DEV_UPDATER !== '1') return
    let installing = false
    const timer = setInterval(async () => {
        if (installing || !isUserIdle()) return
        installing = true
        try {
            await install()
        } catch (error) {
            logger.updater.warn('Could not apply an idle update', error)
        } finally {
            installing = false
        }
    }, CHECK_INTERVAL_MS)
    timer.unref()
    app.once('will-quit', () => clearInterval(timer))
}
