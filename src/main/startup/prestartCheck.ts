import { setAddon } from '../modules/httpServer'
import logger from '../modules/logger'
import { startThemeWatcher } from '../modules/nativeModules'
import { getState } from '../modules/state'
import { getAddonsRoot } from '../utils/addonPaths'
import { migrateLegacyAddonSettings } from '../utils/addonSettingsMigration'
import { createDefaultAddonIfNotExists } from '../utils/addonUtils'
import { checkAsar, isLinux } from '../utils/appUtils'
import { musicPath, selectedAddon, setAsarFilename, setSelectedAddon } from './runtimeState'

const State = getState()

function initializeAddon(): void {
    setSelectedAddon(State.get('addons.theme') || 'Default')
    logger.main.log('Addons: theme changed to:', selectedAddon)
    setAddon(selectedAddon)
}

export async function prestartCheck(): Promise<void> {
    if (isLinux() && State.get('settings.modFilename')) {
        setAsarFilename(`${State.get('settings.modFilename')}.backup.asar`)
        if (!musicPath) {
            logger.main.warn('Yandex Music path is unavailable during prestart check')
        }
    }

    if (typeof State.get('settings.closeAppInTray') !== 'boolean') {
        State.set('settings.closeAppInTray', false)
    }
    checkAsar()
    initializeAddon()

    const themesPath = getAddonsRoot()
    createDefaultAddonIfNotExists(themesPath)
    await migrateLegacyAddonSettings(themesPath)
    try {
        startThemeWatcher(themesPath)
    } catch (error) {
        logger.main.error('Error setting up file watcher for themes:', error)
    }
}
