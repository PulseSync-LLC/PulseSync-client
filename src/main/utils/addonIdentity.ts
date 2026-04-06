import { createHash, randomUUID } from 'node:crypto'

type AddonIdentitySource = {
    author?: unknown
    id?: unknown
    name?: unknown
    storeAddonId?: unknown
    type?: unknown
}

const DEFAULT_ADDON_ID = 'default'
const DEFAULT_ADDON_NAME = 'Default'
const MAX_ID_LENGTH = 96

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeLocalAddonId = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/^addon-/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, MAX_ID_LENGTH)

const normalizeAuthors = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .map(item => readText(item))
            .filter(Boolean)
            .map(item => item.toLowerCase())
    }

    const author = readText(value)
    return author ? [author.toLowerCase()] : []
}

const normalizeAddonName = (value: unknown): string =>
    readText(value)
        .toLowerCase()
        .replace(/\s+/g, ' ')

const normalizeAddonType = (value: unknown): string => readText(value).toLowerCase()

export const isDefaultAddon = (source: Pick<AddonIdentitySource, 'name'>): boolean => readText(source.name) === DEFAULT_ADDON_NAME

export const createGeneratedLocalAddonId = (): string => randomUUID().replace(/-/g, '')

export const createDeterministicLocalAddonId = (source: AddonIdentitySource): string => {
    const payload = JSON.stringify({
        author: normalizeAuthors(source.author),
        name: normalizeAddonName(source.name),
        type: normalizeAddonType(source.type),
    })
    const digest = createHash('sha256').update(payload).digest('hex').slice(0, 24)
    return digest
}

export const resolveAddonPublicationFingerprint = (source: AddonIdentitySource): string => {
    if (isDefaultAddon(source)) {
        return DEFAULT_ADDON_ID
    }

    const name = normalizeAddonName(source.name)
    const type = normalizeAddonType(source.type)
    const authors = normalizeAuthors(source.author).sort()

    if (!name || !type) {
        return ''
    }

    return JSON.stringify({
        authors,
        name,
        type,
    })
}

export const resolveAddonStableId = (source: AddonIdentitySource, fallbackId?: string): string => {
    if (isDefaultAddon(source)) {
        return DEFAULT_ADDON_ID
    }

    const existingId = normalizeLocalAddonId(readText(source.id))
    if (existingId) {
        return existingId
    }

    const normalizedFallback = normalizeLocalAddonId(readText(fallbackId))
    if (normalizedFallback) {
        return normalizedFallback
    }

    return createDeterministicLocalAddonId(source)
}

export const resolveAddonCanonicalId = (source: AddonIdentitySource, fallbackId?: string): string => {
    if (isDefaultAddon(source)) {
        return DEFAULT_ADDON_ID
    }

    const storeAddonId = normalizeLocalAddonId(readText(source.storeAddonId))
    if (storeAddonId) {
        return storeAddonId
    }

    return resolveAddonStableId(source, fallbackId)
}

export const resolveAddonDirectoryKey = (
    source: AddonIdentitySource,
    fallbackId?: string,
    options?: { preferStoreId?: boolean },
): string => {
    if (isDefaultAddon(source)) {
        return DEFAULT_ADDON_NAME
    }

    return options?.preferStoreId ? resolveAddonCanonicalId(source, fallbackId) : resolveAddonStableId(source, fallbackId)
}

export const computeAddonPackageHash = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')
