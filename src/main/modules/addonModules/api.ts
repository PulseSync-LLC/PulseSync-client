import mainHttpClient from '../../http/client'
import { sha256, throwModuleError } from './protocol'

import type { ModuleAddon } from './protocol'

export const requestModuleRuntime = async <T>(route: string, body: unknown, authToken: string): Promise<T> => {
    const response = await mainHttpClient.post<T>(`/extensions/modules/runtime/${route}`, { body, authToken, timeoutMs: 15000 })
    if (!response.ok) throwModuleError(response.status === 403 ? 'access-denied' : 'unavailable')
    return response.data
}
export const bindInstalledAddon = (addon: ModuleAddon, authToken: string) =>
    requestModuleRuntime<{ releaseBinding: string }>(
        'bind',
        {
            catalogAddonId: addon.catalogAddonId,
            runtimeId: addon.id,
            codeHash: sha256(addon.code),
            manifestHash: sha256(JSON.stringify(addon.securityManifest)),
        },
        authToken,
    )
