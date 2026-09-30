import logger from '../../shared/logger'
import mainHttpClient from '../http/client'
import { sha256, throwModuleError } from './protocol'

import type { ModuleAddon } from './protocol'

export type ModuleOperation = { deadline: number; signal: AbortSignal }

export const assertModuleOperation = (operation?: ModuleOperation) => {
    if (operation && (operation.signal.aborted || Date.now() >= operation.deadline)) throwModuleError('aborted')
}

export const requestModuleRuntime = async <T>(route: string, body: unknown, authToken: string, operation?: ModuleOperation): Promise<T> => {
    assertModuleOperation(operation)
    const response = await mainHttpClient.post<T>(`/extensions/modules/runtime/${route}`, {
        body,
        authToken,
        timeoutMs: operation ? Math.min(15000, Math.max(1, operation.deadline - Date.now())) : 15000,
        signal: operation?.signal,
    })
    assertModuleOperation(operation)
    if (!response.ok) {
        const message = (response.data as { message?: unknown } | null)?.message
        const code = typeof message === 'string' && /^MODULE_[A-Z0-9_]+$/.test(message) ? message : 'UNKNOWN_ERROR'
        logger.http.warn(`[PulseSync modules] ${route} failed: HTTP ${response.status}, ${code}`)
        throwModuleError(response.status === 403 ? 'access-denied' : 'unavailable')
    }
    return response.data
}
export const bindInstalledAddon = (addon: ModuleAddon, authToken: string, operation?: ModuleOperation) =>
    requestModuleRuntime<{ releaseBinding: string }>(
        'bind',
        {
            catalogAddonId: addon.catalogAddonId,
            runtimeId: addon.id,
            codeHash: sha256(addon.code),
            manifestHash: sha256(JSON.stringify(addon.securityManifest)),
        },
        authToken,
        operation,
    )
