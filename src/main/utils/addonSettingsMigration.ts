import path from 'path'
import * as fs from 'original-fs'
import { collectAddonSettingsValuesFromConfig, HANDLE_EVENTS_FILENAME, HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import logger from '../modules/logger'

const isNonEmptyObject = (value: Record<string, unknown>): boolean => Object.keys(value).length > 0

export const migrateLegacyAddonSettings = async (addonsRoot: string): Promise<void> => {
    let entries: fs.Dirent[] = []

    try {
        entries = await fs.promises.readdir(addonsRoot, { withFileTypes: true })
    } catch {
        return
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const addonPath = path.join(addonsRoot, entry.name)
        const schemaPath = path.join(addonPath, HANDLE_EVENTS_FILENAME)
        const settingsPath = path.join(addonPath, HANDLE_EVENTS_SETTINGS_FILENAME)

        if (!fs.existsSync(schemaPath) || fs.existsSync(settingsPath)) {
            continue
        }

        try {
            const parsed = JSON.parse(await fs.promises.readFile(schemaPath, 'utf8')) as { sections?: Array<{ items?: Array<Record<string, unknown>> }> }
            const values = collectAddonSettingsValuesFromConfig(parsed)

            if (!isNonEmptyObject(values)) {
                continue
            }

            await fs.promises.writeFile(settingsPath, JSON.stringify(values, null, 4), 'utf8')
            logger.main.info(`Addons: migrated legacy settings for ${entry.name} to ${HANDLE_EVENTS_SETTINGS_FILENAME}.`)
        } catch (error) {
            logger.main.warn(`Addons: failed to migrate legacy settings for ${entry.name}: ${String(error)}`)
        }
    }
}
