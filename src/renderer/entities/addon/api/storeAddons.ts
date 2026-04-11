import config from '@common/appConfig'
import type Addon from '@entities/addon/model/addon.interface'
import type { StoreAddon } from '@entities/addon/model/storeAddon.interface'
import getUserToken from '@shared/lib/auth/getUserToken'
import MainEvents from '@common/types/mainEvents'
import RendererEvents from '@common/types/rendererEvents'

type OwnAddonsResponse = {
    addons?: StoreAddon[]
    ok?: boolean
}

type StoreAddonUpdatesResponse = {
    addons?: StoreAddon[]
    ok?: boolean
}

type PackageArchiveResponse = {
    base64?: string
    fileName?: string
    reason?: string
    success?: boolean
}

type AddonStoreSubmitSuccessPayload = {
    addon?: { id?: string | null } | null
    addonId?: string | null
    data?: {
        addon?: { id?: string | null } | null
        addonId?: string | null
        id?: string | null
    } | null
    id?: string | null
    ok?: boolean
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

function extractStoreAddonId(payload: AddonStoreSubmitSuccessPayload | null): string | null {
    const candidates = [payload?.addon?.id, payload?.addonId, payload?.id, payload?.data?.addon?.id, payload?.data?.addonId, payload?.data?.id]

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim()
        }
    }

    return null
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

export async function fetchStoreAddonUpdates(ids: string[]): Promise<StoreAddon[]> {
    const normalizedIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)))

    if (!normalizedIds.length) {
        return []
    }

    const response = await fetch(`${config.SERVER_URL}/extensions/updates`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
        },
        body: JSON.stringify({ ids: normalizedIds }),
    })

    const payload = (await response.json().catch((): null => null)) as StoreAddonUpdatesResponse | null
    if (!response.ok || payload?.ok === false) {
        throw new Error('FAILED_TO_LOAD_STORE_ADDON_UPDATES')
    }

    return Array.isArray(payload?.addons) ? payload.addons : []
}

export async function persistAddonStoreLink(addon: Addon, storeAddonId: string): Promise<void> {
    if (!addon?.path || !storeAddonId.trim()) {
        return
    }

    try {
        const metadataPath = `${addon.path}/metadata.json`
        const rawMetadata = (await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.READ_FILE, metadataPath, {
            encoding: 'utf8',
        })) as string | null

        if (!rawMetadata) {
            return
        }

        const parsedMetadata = JSON.parse(rawMetadata) as Partial<Addon>
        parsedMetadata.storeAddonId = storeAddonId.trim()
        parsedMetadata.installSource = parsedMetadata.installSource === 'store' ? 'store' : 'local'

        await window.desktopEvents?.invoke(MainEvents.FILE_EVENT, RendererEvents.WRITE_FILE, metadataPath, JSON.stringify(parsedMetadata, null, 4))
    } catch (error) {
        console.error('[AddonStore] failed to persist store addon link', error)
    }
}

export async function submitAddonForStore(addon: Addon, changelog: string, githubUrl: string, existingAddonId?: string): Promise<string | null> {
    const { blob, fileName } = await packageAddon(addon)
    return submitAddonArchiveForStore({ addon, blob, changelog, existingAddonId, fileName, githubUrl })
}

export async function submitAddonArchiveForStore(options: {
    addon: Addon
    changelog: string
    githubUrl: string
    existingAddonId?: string
    blob: Blob
    fileName: string
}): Promise<string | null> {
    const formData = new FormData()
    formData.append('name', options.addon.name)
    formData.append('description', options.addon.description || '')
    formData.append('githubUrl', options.githubUrl.trim())
    formData.append('changelog', options.changelog)
    formData.append('zipFile', options.blob, options.fileName)

    const targetUrl = options.existingAddonId
        ? `${config.SERVER_URL}/extensions/${encodeURIComponent(options.existingAddonId)}/update`
        : `${config.SERVER_URL}/extensions/create`

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
    })

    const payload = (await response.json().catch((): null => null)) as (AddonStoreErrorPayload & AddonStoreSubmitSuccessPayload) | null
    if (!response.ok || payload?.ok === false) {
        const resolvedError = pickErrorCode(payload)
        throw new AddonStoreSubmitError(resolvedError.code, {
            message: resolvedError.message,
            availableAt: resolvedError.availableAt,
            statusCode: payload?.statusCode ?? response.status,
        })
    }

    return extractStoreAddonId(payload)
}
