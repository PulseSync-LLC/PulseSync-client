import config from '@common/appConfig'
import type Addon from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import getUserToken from '@shared/lib/auth/getUserToken'
import MainEvents from '@common/types/mainEvents'

type OwnAddonsResponse = {
    addons?: StoreAddon[]
    ok?: boolean
}

type PackageArchiveResponse = {
    base64?: string
    fileName?: string
    reason?: string
    success?: boolean
}

function getAuthHeaders(extra?: HeadersInit): HeadersInit {
    const token = getUserToken()
    return {
        authorization: token ? `Bearer ${token}` : '',
        ...(extra || {}),
    }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType })
}

async function packageAddon(addon: Addon): Promise<{ blob: Blob; fileName: string }> {
    const packaged = (await window.desktopEvents?.invoke(MainEvents.PACKAGE_ADDON_ARCHIVE, {
        name: addon.directoryName || addon.name,
        path: addon.path,
    })) as PackageArchiveResponse | undefined

    if (!packaged?.success || !packaged.base64 || !packaged.fileName) {
        throw new Error(packaged?.reason || 'PACKAGE_FAILED')
    }

    return {
        blob: base64ToBlob(packaged.base64, 'application/zip'),
        fileName: packaged.fileName,
    }
}

export async function fetchOwnStoreAddons(): Promise<StoreAddon[]> {
    const response = await fetch(`${config.SERVER_URL}/extensions/mine`, {
        headers: {
            Accept: 'application/json',
            ...getAuthHeaders(),
        },
    })

    const payload = (await response.json().catch((): null => null)) as OwnAddonsResponse | null
    if (!response.ok || payload?.ok === false) {
        throw new Error('FAILED_TO_LOAD_OWN_ADDONS')
    }

    return Array.isArray(payload?.addons) ? payload.addons : []
}

export async function submitAddonForStore(addon: Addon, existingAddonId?: string): Promise<void> {
    const { blob, fileName } = await packageAddon(addon)
    const formData = new FormData()
    formData.append('name', addon.name)
    formData.append('description', addon.description || '')
    formData.append('zipFile', blob, fileName)

    const targetUrl = existingAddonId
        ? `${config.SERVER_URL}/extensions/${encodeURIComponent(existingAddonId)}/update`
        : `${config.SERVER_URL}/extensions/create`

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
    })

    const payload = await response.json().catch((): null => null)
    if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || 'ADDON_UPLOAD_FAILED')
    }
}
