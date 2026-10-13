import { ipcMain } from 'electron'

import * as fsp from 'fs/promises'
import path from 'path'

import MainEvents from '@common/types/mainEvents'

import logger from '../../shared/logger'
import { sendAllAddonSettings, sendExtensions, setAddon } from '../httpServer'
import { selectedAddon, setSelectedAddon } from '../startup/runtimeState'
import { getState } from '../state'
import { getAddonsRoot, resolveExistingDirectoryInsideBase } from '../utils/addonPaths'
import { loadAddons } from '../utils/addonUtils'

const State = getState()

const readStoredAddonScripts = (): string[] => {
    const scripts = State.get('addons.scripts')

    if (typeof scripts === 'string') {
        return scripts
            .split(',')
            .map(script => script.trim())
            .filter(Boolean)
    }

    return Array.isArray(scripts) ? scripts.map(script => String(script || '').trim()).filter(Boolean) : []
}

const syncAddonClients = async (): Promise<void> => {
    setSelectedAddon(State.get('addons.theme') || 'Default')
    setAddon(selectedAddon)
    await sendExtensions()
    sendAllAddonSettings({ force: true })
}

export function registerAddonEvents(): void {
    ipcMain.handle(MainEvents.DELETE_ADDON_DIRECTORY, async (_event, themeDirectoryPath: string) => {
        try {
            const addonsRoot = getAddonsRoot()
            const addonDirectoryPath = resolveExistingDirectoryInsideBase(addonsRoot, String(themeDirectoryPath || ''))
            if (!addonDirectoryPath) {
                return { success: false, reason: 'INVALID_ADDON_PATH' }
            }

            const addonDirectoryName = path.basename(addonDirectoryPath)
            if (addonDirectoryName === 'Default') {
                return { success: false, reason: 'DEFAULT_ADDON_DELETE_BLOCKED' }
            }

            if (State.get('addons.theme') === addonDirectoryName) {
                State.set('addons.theme', 'Default')
            }

            const nextScripts = readStoredAddonScripts().filter(script => script !== addonDirectoryName)
            State.set('addons.scripts', nextScripts)

            await fsp.rm(addonDirectoryPath, {
                recursive: true,
                force: true,
            })

            const addons = await loadAddons()
            await syncAddonClients()

            return {
                success: true,
                addons,
                scripts: State.get('addons.scripts') || [],
                theme: State.get('addons.theme') || 'Default',
            }
        } catch (error) {
            logger.main.error('Ошибка при удалении директории темы:', error)
            return { success: false, reason: error instanceof Error ? error.message : 'DELETE_FAILED' }
        }
    })

    ipcMain.handle(MainEvents.SET_ADDON_ENABLED, async (_event, payload: { directoryName?: string; enabled?: boolean }) => {
        try {
            const directoryName = String(payload?.directoryName || '').trim()
            if (!directoryName) {
                return { success: false, reason: 'ADDON_DIRECTORY_REQUIRED' }
            }

            const addons = await loadAddons()
            const addon = addons.find(item => item.directoryName === directoryName)
            if (!addon) {
                return { success: false, reason: 'ADDON_NOT_FOUND' }
            }

            const enabled = Boolean(payload?.enabled)
            if (addon.type === 'theme') {
                State.set('addons.theme', enabled ? addon.directoryName : 'Default')
            } else {
                const scripts = new Set(readStoredAddonScripts())
                if (enabled) {
                    scripts.add(addon.directoryName)
                } else {
                    scripts.delete(addon.directoryName)
                }
                State.set('addons.scripts', Array.from(scripts))
            }

            const nextAddons = await loadAddons()
            await syncAddonClients()

            return {
                success: true,
                addons: nextAddons,
                scripts: State.get('addons.scripts') || [],
                theme: State.get('addons.theme') || 'Default',
            }
        } catch (error) {
            logger.main.error('Ошибка при изменении состояния аддона:', error)
            return { success: false, reason: error instanceof Error ? error.message : 'SET_ADDON_ENABLED_FAILED' }
        }
    })
}
