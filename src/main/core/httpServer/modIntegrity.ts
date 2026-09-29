import logger from '../../shared/logger'
import { isDeveloperAccount } from '../auth/developerAccess'
import { verifyInstalledModIntegrity } from '../mod/integrity'
import { isModIntegrityCheckEnabled } from '../mod/integrityExperiment'

import type { ModIntegrityResult } from '../mod/integrity'
import type { Server, Socket } from 'socket.io'

const RECHECK_INTERVAL_MS = 30_000

async function verifyAccess(): Promise<ModIntegrityResult> {
    if (!(await isModIntegrityCheckEnabled())) return { ok: true }
    return (await isDeveloperAccount()) ? { ok: true } : verifyInstalledModIntegrity()
}

export function registerModSocketIntegrity(io: Server): void {
    let timer: ReturnType<typeof setInterval> | null = null
    let checking = false
    const musicSockets = () => [...io.sockets.sockets.values()].filter(socket => socket.data.modIntegrityVerified === true)
    const stopMonitoring = () => {
        if (timer) clearInterval(timer)
        timer = null
    }
    const rejectSocket = (socket: Socket, reason: string) => {
        socket.data.modIntegrityVerified = false
        ;(socket as Socket & { hasPong?: boolean }).hasPong = false
        logger.http.warn('Mod socket disconnected: ASAR integrity check failed', { reason })
        socket.emit('MOD_INTEGRITY_ERROR', { reason })
        socket.disconnect(true)
    }

    io.use((socket, next) => {
        const clientType = socket.handshake.query.type || 'yaMusic'
        socket.data.modIntegrityVerified = false
        if (clientType !== 'yaMusic') return next()

        void verifyAccess()
            .then(result => {
                if (!result.ok) {
                    logger.http.warn('Mod socket refused: ASAR integrity check failed', { reason: result.reason })
                    next(new Error(`mod-integrity:${result.reason}`))
                    return
                }
                socket.data.modIntegrityVerified = true
                next()
            })
            .catch(() => next(new Error('mod-integrity:asar-unavailable')))
    })

    io.on('connection', socket => {
        if (socket.data.modIntegrityVerified !== true) return
        if (!timer) {
            timer = setInterval(() => {
                if (checking) return
                const sockets = musicSockets()
                if (!sockets.length) return stopMonitoring()
                checking = true
                void verifyAccess()
                    .then(result => {
                        if (!result.ok) sockets.filter(socket => socket.connected).forEach(socket => rejectSocket(socket, result.reason))
                    })
                    .catch(() => sockets.filter(socket => socket.connected).forEach(socket => rejectSocket(socket, 'asar-unavailable')))
                    .finally(() => {
                        checking = false
                    })
            }, RECHECK_INTERVAL_MS)
            timer.unref()
        }
        socket.once('disconnect', () => {
            if (!musicSockets().length) stopMonitoring()
        })
    })
    io.engine.once('close', stopMonitoring)
}
