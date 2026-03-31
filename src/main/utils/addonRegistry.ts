import { app } from 'electron'
import * as fs from 'original-fs'
import * as path from 'path'

type AddonMetadataRecord = {
    directoryName: string
    id?: string
    name?: string
    storeAddonId?: string
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
        .map(folder => {
            const metadataPath = path.join(addonsRoot, folder, 'metadata.json')
            if (!fs.existsSync(metadataPath)) return null

            try {
                const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
                return {
                    directoryName: folder,
                    id: readText(parsed.id),
                    name: readText(parsed.name),
                    storeAddonId: readText(parsed.storeAddonId),
                }
            } catch {
                return null
            }
        })
        .filter((item): item is AddonMetadataRecord => Boolean(item))
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
