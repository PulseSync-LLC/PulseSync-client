import * as fs from 'original-fs'
import * as path from 'path'
import { app } from 'electron'
import {
    type AddonSettingsValues,
    type HandleConfig,
    HANDLE_EVENTS_FILENAME,
    HANDLE_EVENTS_SETTINGS_FILENAME,
    extractHandleConfigItemDefaultValue,
    extractHandleConfigItemValue,
    normalizeAddonSettingsValues,
} from '@common/addons/handleEvents'
import { resolveAddonDirectory, resolveAddonDisplayName } from '../../utils/addonRegistry'

export type AddonSettingsPayload = Record<string, any>

const getAddonRoot = () => path.join(app.getPath('appData'), 'PulseSync', 'addons')

const readAddonSettingsValuesFile = (directory: string): AddonSettingsValues => {
    const valuesPath = path.join(getAddonRoot(), directory, HANDLE_EVENTS_SETTINGS_FILENAME)
    if (!fs.existsSync(valuesPath)) {
        return {}
    }

    try {
        return normalizeAddonSettingsValues(JSON.parse(fs.readFileSync(valuesPath, 'utf8')))
    } catch {
        return {}
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

    const handlePath = path.join(getAddonRoot(), directory, HANDLE_EVENTS_FILENAME)
    if (!fs.existsSync(handlePath)) return {}

    try {
        const parsed = JSON.parse(fs.readFileSync(handlePath, 'utf8')) as HandleConfig
        return transformAddonHandleConfig(parsed, readAddonSettingsValuesFile(directory))
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
