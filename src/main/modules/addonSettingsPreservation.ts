import path from 'path'
import * as fsp from 'fs/promises'

import { HANDLE_EVENTS_SETTINGS_FILENAME } from '../../common/addons/handleEvents'

export type PreservedAddonSettings = string | null

export const readPreservedAddonSettings = async (addonDir: string): Promise<PreservedAddonSettings> => {
    try {
        return await fsp.readFile(path.join(addonDir, HANDLE_EVENTS_SETTINGS_FILENAME), 'utf8')
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return null
        }

        throw error
    }
}

export const restorePreservedAddonSettings = async (addonDir: string, preservedSettings: PreservedAddonSettings): Promise<void> => {
    if (preservedSettings == null) {
        return
    }

    await fsp.mkdir(addonDir, { recursive: true })
    await fsp.writeFile(path.join(addonDir, HANDLE_EVENTS_SETTINGS_FILENAME), preservedSettings, 'utf8')
}
