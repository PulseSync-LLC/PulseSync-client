import path from 'node:path'
import fs from 'original-fs'
import { app } from 'electron'
import { setAddon } from '../modules/httpServer'
import logger from '../modules/logger'
import { getState } from '../modules/state'
import { startThemeWatcher } from '../modules/nativeModules'
import { checkAsar, isLinux } from '../utils/appUtils'
import { createDefaultAddonIfNotExists } from '../utils/addonUtils'
import { migrateLegacyAddonSettings } from '../utils/addonSettingsMigration'
import { getAddonsRoot } from '../utils/addonPaths'
import { musicPath, selectedAddon, setAsarFilename, setSelectedAddon } from './runtimeState'

const State = getState()

function initializeAddon(): void {
    setSelectedAddon(State.get('addons.theme') || 'Default')
    logger.main.log('Addons: theme changed to:', selectedAddon)
    setAddon(selectedAddon)
}

export async function prestartCheck(): Promise<void> {
    const pulseSyncMusicPath = path.join(app.getPath('music'), 'PulseSyncMusic')
    if (!fs.existsSync(pulseSyncMusicPath)) {
        try {
            fs.mkdirSync(pulseSyncMusicPath, { recursive: true })
        } catch (error) {
            logger.main.error('Ошибка при создании директории PulseSyncMusic:', error)
        }
    }

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
