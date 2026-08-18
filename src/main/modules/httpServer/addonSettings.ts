import * as fs from 'original-fs'
import * as path from 'path'

import {
    type AddonSettingsValues,
    extractHandleConfigItemDefaultValue,
    extractHandleConfigItemValue,
    HANDLE_EVENTS_FILENAME,
    HANDLE_EVENTS_SETTINGS_FILENAME,
    type HandleConfig,
    normalizeAddonSettingsValues,
} from '@common/addons/handleEvents'

import { getAddonsRoot } from '../../utils/addonPaths'
import { resolveAddonDirectory, resolveAddonDisplayName } from '../../utils/addonRegistry'

export type AddonSettingsPayload = Record<string, any>

const readStoredValue = (storedValues: AddonSettingsValues | undefined, keys: string[]): unknown => {
    if (!storedValues) {
        return undefined
    }

    for (const key of keys) {
        if (key && Object.prototype.hasOwnProperty.call(storedValues, key)) {
            return storedValues[key]
        }
    }

    return undefined
}

const readAddonSettingsValuesFile = (directory: string): AddonSettingsValues => {
    const valuesPath = path.join(getAddonsRoot(), directory, HANDLE_EVENTS_SETTINGS_FILENAME)
    if (!fs.existsSync(valuesPath)) {
        return {}
    }

    try {
        return normalizeAddonSettingsValues(JSON.parse(fs.readFileSync(valuesPath, 'utf8')))
    } catch {
        return {}
    }
}

const readAddonSettingsSchema = (directory: string): HandleConfig | null => {
    const addonRoot = path.join(getAddonsRoot(), directory)
    const metadataPath = path.join(addonRoot, 'metadata.json')

    try {
        if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { type?: unknown; settings?: unknown }
            if (
                metadata.type === 'web-addon' &&
                metadata.settings &&
                typeof metadata.settings === 'object' &&
                Array.isArray((metadata.settings as HandleConfig).sections)
            ) {
                return metadata.settings as HandleConfig
            }
        }
    } catch {}

    const handlePath = path.join(addonRoot, HANDLE_EVENTS_FILENAME)
    if (!fs.existsSync(handlePath)) return null

    try {
        return JSON.parse(fs.readFileSync(handlePath, 'utf8')) as HandleConfig
    } catch {
        return null
    }
}

export const transformAddonHandleConfig = (input: HandleConfig | null | undefined, storedValues?: AddonSettingsValues): AddonSettingsPayload => {
    const result: AddonSettingsPayload = {}
    if (!Array.isArray(input?.sections)) {
        return result
    }

    for (const section of input.sections) {
        if (!Array.isArray(section?.items)) continue

        for (const item of section.items) {
            if (!item?.id || typeof item.id !== 'string') continue

            if (item.type === 'text' && Array.isArray(item.buttons)) {
                if (item.buttons.length === 1 && (!item.buttons[0]?.id || typeof item.buttons[0].id !== 'string')) {
                    const button = item.buttons[0]
                    const storedValue = readStoredValue(storedValues, [item.id, `${item.id}_1`])
                    result[item.id] = {
                        value: typeof storedValue !== 'undefined' ? storedValue : (button?.value ?? button?.text),
                        default: button?.defaultValue ?? button?.defaultParameter,
                    }
                    continue
                }

                result[item.id] = item.buttons.reduce(
                    (acc, button) => {
                        if (!button?.id || typeof button.id !== 'string') return acc
                        acc[button.id] = {
                            value:
                                storedValues && Object.prototype.hasOwnProperty.call(storedValues, button.id)
                                    ? storedValues[button.id]
                                    : (button.value ?? button.text),
                            default: button.defaultValue ?? button.defaultParameter,
                        }
                        return acc
                    },
                    {} as Record<string, { value: unknown; default: unknown }>,
                )
                continue
            }

            result[item.id] = {
                value: extractHandleConfigItemValue(item, storedValues),
                default: extractHandleConfigItemDefaultValue(item),
            }
        }
    }

    return result
}

export const readAddonSettings = (addonName: string): AddonSettingsPayload => {
    if (!addonName || typeof addonName !== 'string') return {}

    const directory = resolveAddonDirectory(addonName)
    if (!directory) return {}

    const schema = readAddonSettingsSchema(directory)
    return schema ? transformAddonHandleConfig(schema, readAddonSettingsValuesFile(directory)) : {}
}

export const readAllAddonSettings = (): Record<string, AddonSettingsPayload> => {
    const addonsRoot = getAddonsRoot()
    const result: Record<string, AddonSettingsPayload> = {}

    let folders: string[] = []
    try {
        folders = fs.readdirSync(addonsRoot)
    } catch {
        return result
    }

    for (const folder of folders) {
        const schema = readAddonSettingsSchema(folder)
        if (!schema) continue
        result[resolveAddonDisplayName(folder) || folder] = transformAddonHandleConfig(schema, readAddonSettingsValuesFile(folder))
    }

    return result
}
