import * as fs from 'original-fs'
import * as path from 'path'

import { resolveAddonPublicationFingerprint } from './addonIdentity'
import { getAddonsRoot } from './addonPaths'

type AddonMetadataRecord = {
    author?: string | string[]
    directoryName: string
    fingerprint?: string
    id?: string
    installSource?: 'local' | 'store'
    name?: string
    storeAddonId?: string
    storeReleaseChannel?: 'stable' | 'dev'
    type?: string
    version?: string
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const readAddonMetadata = (directoryName: string): AddonMetadataRecord | null => {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(getAddonsRoot(), directoryName, 'metadata.json'), 'utf8')) as Record<string, unknown>
        return {
            author: (parsed.author as string | string[] | undefined) || undefined,
            directoryName,
            fingerprint: resolveAddonPublicationFingerprint(parsed),
            id: readText(parsed.id),
            installSource: readText(parsed.installSource) === 'store' ? 'store' : 'local',
            name: readText(parsed.name),
            storeAddonId: readText(parsed.storeAddonId),
            storeReleaseChannel: parsed.storeReleaseChannel === 'dev' ? 'dev' : 'stable',
            type: readText(parsed.type),
            version: readText(parsed.version),
        }
    } catch {
        return null
    }
}

export const listAddonMetadata = (): AddonMetadataRecord[] => {
    try {
        return fs
            .readdirSync(getAddonsRoot())
            .map(readAddonMetadata)
            .filter((item): item is AddonMetadataRecord => item !== null)
    } catch {
        return []
    }
}

export const resolveAddonDirectory = (ref: unknown): string => {
    const raw = readText(ref)
    if (!raw) return ''

    const directPath = path.join(getAddonsRoot(), raw)
    if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
        return raw
    }

    const lower = raw.toLowerCase()
    const match = listAddonMetadata().find(
        addon =>
            addon.directoryName.toLowerCase() === lower ||
            readText(addon.id).toLowerCase() === lower ||
            readText(addon.storeAddonId).toLowerCase() === lower ||
            readText(addon.name).toLowerCase() === lower,
    )

    return match?.directoryName || ''
}

export const resolveAddonIdentity = (ref: unknown): { directoryName: string; name: string; id: string } | null => {
    const directoryName = resolveAddonDirectory(ref)
    if (!directoryName) return null
    const metadata = readAddonMetadata(directoryName)
    return { directoryName, name: readText(metadata?.name) || directoryName, id: readText(metadata?.id) || directoryName }
}

export const resolveAddonDisplayName = (ref: unknown): string => resolveAddonIdentity(ref)?.name || ''

export const resolveAddonId = (ref: unknown): string => resolveAddonIdentity(ref)?.id || ''

export const findAddonByPublicationFingerprint = (fingerprint: unknown, installSource?: 'local' | 'store'): AddonMetadataRecord | null => {
    const normalizedFingerprint = readText(fingerprint)
    if (!normalizedFingerprint) return null

    return (
        listAddonMetadata().find(item => {
            if (installSource && item.installSource !== installSource) {
                return false
            }

            return readText(item.fingerprint) === normalizedFingerprint
        }) ?? null
    )
}
