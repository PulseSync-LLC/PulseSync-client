import { BrowserWindow, ipcMain } from 'electron'

import MainEvents from '../../../common/types/mainEvents'
import RendererEvents from '../../../common/types/rendererEvents'

import type { AddonRecoveryEntry, DesktopAddonRecoveryRequest, DesktopAddonRecoverySnapshot } from '../../../common/addons/recovery'
import type { Socket } from 'socket.io'

type Session = { socket: Socket; supported: boolean; entries: AddonRecoveryEntry[] | null }

function parseSnapshot(value: unknown): AddonRecoveryEntry[] | null {
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('entries' in value)) return null
    if (!Array.isArray(value.entries) || value.entries.length > 512) return null
    const entries: AddonRecoveryEntry[] = []
    for (const entry of value.entries) {
        if (
            !entry ||
            !['legacy', 'webhost'].includes(entry.runtime) ||
            !['quarantined', 'retrying'].includes(entry.status) ||
            !['id', 'directoryName', 'fingerprint', 'name', 'reason', 'details'].every(key => typeof entry[key] === 'string') ||
            !entry.id ||
            entry.id.length > 1024 ||
            entry.directoryName.length > 1024 ||
            !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
            !Number.isFinite(entry.failedAt)
        )
            return null
        entries.push({
            runtime: entry.runtime,
            status: entry.status,
            id: entry.id,
            directoryName: entry.directoryName,
            fingerprint: entry.fingerprint,
            name: entry.name.slice(0, 512),
            reason: entry.reason.slice(0, 2000),
            details: entry.details.slice(0, 12000),
            failedAt: entry.failedAt,
        })
    }
    return entries
}

export function createAddonRecoveryService(getAuthorized: () => boolean) {
    const sessions = new Map<string, Session>()
    let offlineEntries: DesktopAddonRecoverySnapshot['entries'] = []

    const getSnapshot = (): DesktopAddonRecoverySnapshot => {
        const ready = [...sessions.values()].filter(session => session.supported && session.entries !== null)
        const connection = ready.length
            ? 'connected'
            : [...sessions.values()].some(session => session.supported)
              ? 'loading'
              : sessions.size
                ? 'unsupported'
                : 'disconnected'
        return {
            connection,
            entries: sessions.size
                ? ready.flatMap(session => session.entries!.map(entry => ({ ...entry, sourceId: session.socket.id, connected: true })))
                : offlineEntries,
        }
    }

    const publish = () => {
        const snapshot = getSnapshot()
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(RendererEvents.ADDON_RECOVERY_CHANGED, snapshot)
        }
    }

    const registerSocket = (socket: Socket) => {
        if (socket.data.modIntegrityVerified !== true) return
        socket.on('READY', (payload?: { addonRecoveryProtocolVersion?: number }) => {
            sessions.set(socket.id, { socket, supported: payload?.addonRecoveryProtocolVersion === 1, entries: null })
            offlineEntries = []
            publish()
            if (payload?.addonRecoveryProtocolVersion === 1) socket.emit('ADDON_RECOVERY_GET')
        })
        socket.on('ADDON_RECOVERY_SNAPSHOT', (payload: unknown) => {
            const session = sessions.get(socket.id)
            if (!session?.supported) return
            const entries = parseSnapshot(payload)
            if (!entries) return
            session.entries = entries
            publish()
        })
        socket.on('disconnect', () => {
            if (!sessions.has(socket.id)) return
            offlineEntries = getSnapshot().entries.map(entry => ({ ...entry, connected: false }))
            sessions.delete(socket.id)
            publish()
        })
    }

    const retry = async (request: DesktopAddonRecoveryRequest) => {
        if (!request || typeof request !== 'object' || !getAuthorized()) throw new Error('Addon recovery is unavailable')
        const session = sessions.get(request.sourceId)
        const entry = session?.entries?.find(
            item => item.runtime === request.runtime && item.id === request.id && item.fingerprint === request.fingerprint,
        )
        if (!session?.socket.connected || !entry || entry.status !== 'quarantined')
            throw new Error('Addon recovery state changed. Refresh and try again.')
        const result = await session.socket.timeout(10000).emitWithAck('ADDON_RECOVERY_RETRY', {
            runtime: entry.runtime,
            id: entry.id,
            fingerprint: entry.fingerprint,
        })
        if (result?.ok !== true) throw new Error(typeof result?.error === 'string' ? result.error : 'Addon recovery request failed')
    }

    ipcMain.handle(MainEvents.GET_ADDON_RECOVERY, getSnapshot)
    ipcMain.handle(MainEvents.RETRY_ADDON_RECOVERY, (_event, request: DesktopAddonRecoveryRequest) => retry(request))
    return { registerSocket }
}
