import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { bindInstalledAddon, requestModuleRuntime } from './api'
import { sha256, throwModuleError } from './protocol'

import type { Descriptor, ModuleAddon, Resolution } from './protocol'
import type { Socket } from 'socket.io'

type ModuleActivation = {
    addon: ModuleAddon
    fingerprint: string
    authToken: string
    resolution: Resolution
}

let transportCapability: string | undefined
function getTransportCapability(): string {
    if (!transportCapability) {
        const token = randomBytes(32).toString('hex')
        mkdirSync(app.getPath('userData'), { recursive: true })
        writeFileSync(path.join(app.getPath('userData'), 'addon-module-transport.key'), token, { mode: 0o600 })
        transportCapability = token
    }
    return transportCapability
}

export function registerAddonModuleTransport(socket: Socket, getAuthToken: () => string | null, readAddon: (id: string) => ModuleAddon | undefined) {
    const capability = getTransportCapability()
    const activations = new Map<string, ModuleActivation>()
    const resolving = new Set<string>()
    let inFlight = 0
    const getAddonFingerprint = (addon: ModuleAddon) =>
        sha256(JSON.stringify([addon.id, addon.catalogAddonId, sha256(addon.code), addon.securityManifest]))
    const assertAddonCurrent = (authToken: string, addon: ModuleAddon, fingerprint: string) => {
        const current = readAddon(addon.id)
        if (!socket.connected || getAuthToken() !== authToken || !current || getAddonFingerprint(current) !== fingerprint) throwModuleError('aborted')
    }
    let checkingStatus = false
    const statusTimer = setInterval(async () => {
        if (checkingStatus || !socket.connected || !activations.size) return
        const authToken = getAuthToken()
        if (!authToken) return
        const activationIds = [...activations.keys()]
        checkingStatus = true
        try {
            const status = await requestModuleRuntime<{ invalidatedActivationIds: string[] }>('status', { activationIds }, authToken)
            if (!socket.connected || getAuthToken() !== authToken) return
            for (const activationId of status.invalidatedActivationIds) {
                if (!activationIds.includes(activationId) || !activations.has(activationId)) continue
                activations.delete(activationId)
                socket.emit('ADDON_MODULE_REVOKED', { activationId })
                void requestModuleRuntime('dispose', { activationId }, authToken).catch(() => {})
            }
        } catch {
            // Offline status checks do not claim that a running module has been revoked.
        } finally {
            checkingStatus = false
        }
    }, 30000)
    statusTimer.unref()

    socket.on('ADDON_MODULE_REQUEST', async (request: unknown, ack?: (response: unknown) => void) => {
        if (typeof ack !== 'function') return
        const packet = request as {
            operation?: unknown
            addonId?: unknown
            activationId?: unknown
            alias?: unknown
            transportToken?: unknown
        }
        const authToken = getAuthToken()
        if (
            !authToken ||
            typeof packet?.transportToken !== 'string' ||
            !/^[a-f0-9]{64}$/.test(packet.transportToken) ||
            !timingSafeEqual(Buffer.from(packet.transportToken, 'hex'), Buffer.from(capability, 'hex')) ||
            socket.handshake.headers.origin !== undefined ||
            (socket as Socket & { clientType?: string }).clientType !== 'yaMusic' ||
            inFlight >= 8 ||
            !packet ||
            typeof packet.activationId !== 'string' ||
            !/^[a-f0-9-]{36}$/i.test(packet.activationId)
        ) {
            ack({ ok: false, error: 'access-denied' })
            return
        }
        inFlight++
        let resolvingAddon: string | undefined
        try {
            if (packet.operation === 'resolve') {
                if (typeof packet.addonId !== 'string') throwModuleError()
                if (resolving.has(packet.addonId)) throwModuleError('unavailable')
                resolvingAddon = packet.addonId
                resolving.add(resolvingAddon)
                const addon = readAddon(packet.addonId)
                if (!addon) throwModuleError()
                const fingerprint = getAddonFingerprint(addon)
                const { releaseBinding } = await bindInstalledAddon(addon, authToken)
                assertAddonCurrent(authToken, addon, fingerprint)
                for (const [id, entry] of activations) {
                    if (entry.addon.id === addon.id) {
                        activations.delete(id)
                        await requestModuleRuntime('dispose', { activationId: id }, authToken).catch(() => {})
                    }
                }
                if (activations.size >= 32) throwModuleError('reload-required')
                const resolution = await requestModuleRuntime<Resolution>('resolve', { releaseBinding, activationId: packet.activationId }, authToken)
                assertAddonCurrent(authToken, addon, fingerprint)
                activations.set(packet.activationId, { addon, fingerprint, authToken, resolution })
                ack({ ok: true, value: resolution })
                return
            }
            const entry = activations.get(packet.activationId)
            if (!entry || entry.authToken !== authToken) throwModuleError('aborted')
            const active = entry
            if (packet.operation === 'dispose') {
                activations.delete(packet.activationId)
                await requestModuleRuntime('dispose', { activationId: packet.activationId }, authToken)
                ack({ ok: true, value: null })
                return
            }
            assertAddonCurrent(authToken, active.addon, active.fingerprint)
            if (typeof packet.alias !== 'string' || !Object.hasOwn(active.resolution.descriptors, packet.alias)) throwModuleError('undeclared-module')
            const alias = packet.alias
            const descriptor = active.resolution.descriptors[alias]
            const { releaseBinding } = await bindInstalledAddon(active.addon, authToken)
            assertAddonCurrent(authToken, active.addon, active.fingerprint)
            if (packet.operation !== 'load') throwModuleError('access-denied')
            const permission = await requestModuleRuntime<{ approval: string; descriptor: Descriptor }>(
                'approval',
                {
                    releaseBinding,
                    activationId: packet.activationId,
                    alias,
                    versionId: descriptor.versionId,
                },
                authToken,
            )
            assertAddonCurrent(authToken, active.addon, active.fingerprint)
            if (permission.descriptor.sha256 !== descriptor.sha256 || permission.descriptor.versionId !== descriptor.versionId)
                throwModuleError('integrity-mismatch')
            if (activations.get(packet.activationId) !== active) throwModuleError('aborted')
            ack({ ok: true, value: { approval: permission.approval } })
        } catch (error) {
            if (resolvingAddon) await requestModuleRuntime('dispose', { activationId: packet.activationId }, authToken).catch(() => {})
            const message = error instanceof Error ? error.message : ''
            ack({ ok: false, error: message.startsWith('PulseSync modules: ') ? message.slice(19) : 'unavailable' })
        } finally {
            if (resolvingAddon) resolving.delete(resolvingAddon)
            inFlight--
        }
    })
    socket.once('disconnect', () => {
        clearInterval(statusTimer)
        for (const [activationId, entry] of activations) void requestModuleRuntime('dispose', { activationId }, entry.authToken).catch(() => {})
        activations.clear()
    })
}
