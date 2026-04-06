import { app } from 'electron'
import * as fs from 'original-fs'
import * as path from 'path'
import { resolveAddonPublicationFingerprint } from './addonIdentity'

type AddonMetadataRecord = {
    author?: string | string[]
    directoryName: string
    fingerprint?: string
    id?: string
    installSource?: 'local' | 'store'
    name?: string
    storeAddonId?: string
    type?: string
}

const getAddonRoot = () => path.join(app.getPath('appData'), 'PulseSync', 'addons')

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const listAddonMetadata = (): AddonMetadataRecord[] => {
    const addonsRoot = getAddonRoot()

    let folders: string[] = []
    try {
        folders = fs.readdirSync(addonsRoot)
    } catch {
        return []
    }

    return folders
        .map<AddonMetadataRecord | null>(folder => {
            const metadataPath = path.join(addonsRoot, folder, 'metadata.json')
            if (!fs.existsSync(metadataPath)) return null

            try {
                const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
                return {
                    author: (parsed.author as string | string[] | undefined) || undefined,
                    directoryName: folder,
                    fingerprint: resolveAddonPublicationFingerprint(parsed),
                    id: readText(parsed.id),
                    installSource: readText(parsed.installSource) === 'store' ? 'store' : 'local',
                    name: readText(parsed.name),
                    storeAddonId: readText(parsed.storeAddonId),
                    type: readText(parsed.type),
                }
            } catch {
                return null
            }
        })
        .filter((item): item is AddonMetadataRecord => item !== null)
}

export const resolveAddonDirectory = (ref: unknown): string => {
    const raw = readText(ref)
    if (!raw) return ''

    const directPath = path.join(getAddonRoot(), raw)
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

export const resolveAddonDisplayName = (ref: unknown): string => {
    const directory = resolveAddonDirectory(ref)
    if (!directory) return ''

    const metadata = listAddonMetadata().find(item => item.directoryName === directory)
    return readText(metadata?.name) || directory
}

export const findAddonByStoreAddonId = (storeAddonId: unknown): AddonMetadataRecord | null => {
    const normalizedStoreAddonId = readText(storeAddonId).toLowerCase()
    if (!normalizedStoreAddonId) return null

    return listAddonMetadata().find(item => readText(item.storeAddonId).toLowerCase() === normalizedStoreAddonId) ?? null
}

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
