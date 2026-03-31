import * as fs from 'original-fs'
import * as path from 'path'
import { app } from 'electron'
import { resolveAddonDirectory, resolveAddonDisplayName } from '../../utils/addonRegistry'

type JsonRecord = Record<string, any>

interface HandleConfigItem extends JsonRecord {
    id?: string
    type?: string
    bool?: boolean
    filePath?: string
    input?: string
    selected?: number | string
    value?: unknown
    defaultParameter?: unknown
    buttons?: Array<{
        id?: string
        text?: string
        defaultParameter?: unknown
    }>
}

interface HandleConfigSection {
    items?: HandleConfigItem[]
}

interface HandleConfig {
    sections?: HandleConfigSection[]
}

export type AddonSettingsPayload = Record<string, any>

const HANDLE_EVENTS_FILENAME = 'handleEvents.json'

const getAddonRoot = () => path.join(app.getPath('appData'), 'PulseSync', 'addons')

const extractItemValue = (item: HandleConfigItem): unknown => {
    if (typeof item.bool !== 'undefined') return item.bool
    if (typeof item.filePath !== 'undefined') return item.filePath
    if (typeof item.input !== 'undefined') return item.input
    if (typeof item.selected !== 'undefined') return item.selected
    return item.value
}

export const transformAddonHandleConfig = (input: HandleConfig | null | undefined): AddonSettingsPayload => {
    const result: AddonSettingsPayload = {}
    if (!Array.isArray(input?.sections)) {
        return result
    }

    for (const section of input.sections) {
        if (!Array.isArray(section?.items)) continue

        for (const item of section.items) {
            if (!item?.id || typeof item.id !== 'string') continue

            if (item.type === 'text' && Array.isArray(item.buttons)) {
                result[item.id] = item.buttons.reduce(
                    (acc, button) => {
                        if (!button?.id || typeof button.id !== 'string') return acc
                        acc[button.id] = {
                            value: button.text,
                            default: button.defaultParameter,
                        }
                        return acc
                    },
                    {} as Record<string, { value: unknown; default: unknown }>,
                )
                continue
            }

            result[item.id] = {
                value: extractItemValue(item),
                default: item.defaultParameter,
            }
        }
    }

    return result
}

export const readAddonSettings = (addonName: string): AddonSettingsPayload => {
    if (!addonName || typeof addonName !== 'string') return {}

    const directory = resolveAddonDirectory(addonName)
    if (!directory) return {}

    const handlePath = path.join(getAddonRoot(), directory, HANDLE_EVENTS_FILENAME)
    if (!fs.existsSync(handlePath)) return {}

    try {
        const parsed = JSON.parse(fs.readFileSync(handlePath, 'utf8')) as HandleConfig
        return transformAddonHandleConfig(parsed)
    } catch {
        return {}
    }
}

export const readAllAddonSettings = (): Record<string, AddonSettingsPayload> => {
    const addonsRoot = getAddonRoot()
    const result: Record<string, AddonSettingsPayload> = {}

    let folders: string[] = []
    try {
        folders = fs.readdirSync(addonsRoot)
    } catch {
        return result
    }

    for (const folder of folders) {
        const handlePath = path.join(addonsRoot, folder, HANDLE_EVENTS_FILENAME)
        if (!fs.existsSync(handlePath)) continue
        result[resolveAddonDisplayName(folder) || folder] = readAddonSettings(folder)
    }

    return result
}
