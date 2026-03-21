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

type AddonStoreErrorPayload = {
    error?: string | { error?: string; availableAt?: string; message?: string }
    availableAt?: string
    message?: string | string[] | { error?: string; availableAt?: string; message?: string }
    ok?: boolean
    statusCode?: number
}

export class AddonStoreSubmitError extends Error {
    code: string
    availableAt?: string
    statusCode?: number

    constructor(code: string, options?: { message?: string; availableAt?: string; statusCode?: number }) {
        super(options?.message || code)
        this.name = 'AddonStoreSubmitError'
        this.code = code
        this.availableAt = options?.availableAt
        this.statusCode = options?.statusCode
    }
}

const GENERIC_HTTP_ERROR_LABELS = new Set(['Bad Request', 'Unauthorized', 'Forbidden', 'Not Found', 'Internal Server Error'])

function normalizeAddonStoreErrorCode(raw: string | undefined): string {
    const normalized = String(raw || '').trim()
    if (!normalized) {
        return ''
    }

    if (normalized === 'Authenticated user id is required') {
        return 'AUTHENTICATED_USER_ID_REQUIRED'
    }

    return normalized
}

function pickErrorCode(payload: AddonStoreErrorPayload | null): { code: string; availableAt?: string; message?: string } {
    const messageValue = payload?.message
    const errorValue = payload?.error

    const messageObject = typeof messageValue === 'object' && !Array.isArray(messageValue) && messageValue ? messageValue : null
    const errorObject = typeof errorValue === 'object' && errorValue ? errorValue : null

    const messageString = Array.isArray(messageValue)
        ? messageValue.find(item => typeof item === 'string' && item.trim())
        : typeof messageValue === 'string'
          ? messageValue
          : undefined

    const errorString =
        typeof errorValue === 'string' && !GENERIC_HTTP_ERROR_LABELS.has(errorValue.trim()) && errorValue.trim() ? errorValue : undefined

    const code =
        normalizeAddonStoreErrorCode(messageObject?.error) ||
        normalizeAddonStoreErrorCode(errorObject?.error) ||
        normalizeAddonStoreErrorCode(messageString) ||
        normalizeAddonStoreErrorCode(errorString) ||
        'ADDON_UPLOAD_FAILED'

    return {
        code,
        availableAt: payload?.availableAt || messageObject?.availableAt || errorObject?.availableAt,
        message:
            (typeof messageObject?.message === 'string' && messageObject.message.trim() ? messageObject.message : undefined) ||
            (typeof messageString === 'string' && !GENERIC_HTTP_ERROR_LABELS.has(messageString.trim()) ? messageString : undefined),
    }
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
        throw new AddonStoreSubmitError(packaged?.reason || 'PACKAGE_FAILED')
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

export async function submitAddonForStore(addon: Addon, changelog: string[], existingAddonId?: string): Promise<void> {
    const { blob, fileName } = await packageAddon(addon)
    const formData = new FormData()
    formData.append('name', addon.name)
    formData.append('description', addon.description || '')
    formData.append('changelog', JSON.stringify(changelog))
    formData.append('zipFile', blob, fileName)

    const targetUrl = existingAddonId
        ? `${config.SERVER_URL}/extensions/${encodeURIComponent(existingAddonId)}/update`
        : `${config.SERVER_URL}/extensions/create`

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
    })

    const payload = (await response.json().catch((): null => null)) as AddonStoreErrorPayload | null
    if (!response.ok || payload?.ok === false) {
        const resolvedError = pickErrorCode(payload)
        throw new AddonStoreSubmitError(resolvedError.code, {
            message: resolvedError.message,
            availableAt: resolvedError.availableAt,
            statusCode: payload?.statusCode ?? response.status,
        })
    }
}
