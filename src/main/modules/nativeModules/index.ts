import path from 'path'
import { HANDLE_EVENTS_FILENAME, HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'
import { sendAddon, sendAddonSettings, sendAllAddonSettings, sendExtensions } from '../httpServer'
import logger from '../logger'
import { loadPulseSyncNative } from './pulsesyncNative'

const nativeModule = loadPulseSyncNative()
if (nativeModule) {
    logger.nativeModuleManager.info(`Loaded pulsesyncNative v${nativeModule.nativeVersion()}`)
} else {
    logger.nativeModuleManager.error('pulsesyncNative addon was not found')
}

const handleSettingsFilenames = new Set([HANDLE_EVENTS_FILENAME.toLowerCase(), HANDLE_EVENTS_SETTINGS_FILENAME.toLowerCase()])
const ADDON_REFRESH_DEBOUNCE_MS = 250
let addonRefreshTimer: ReturnType<typeof setTimeout> | null = null

const scheduleAddonRefresh = (): void => {
    if (addonRefreshTimer) clearTimeout(addonRefreshTimer)
    addonRefreshTimer = setTimeout(() => {
        addonRefreshTimer = null
        sendAddon(true)
        void sendExtensions()
    }, ADDON_REFRESH_DEBOUNCE_MS)
}

const tryExtractAddonNameFromWatchPath = (filename: string): string | null => {
    if (!filename) return null

    const normalized = path.normalize(filename)
    if (!handleSettingsFilenames.has(path.basename(normalized).toLowerCase())) return null

    const parts = normalized.split(/[\\/]+/).filter(Boolean)
    if (parts.length < 2) return null
    return parts[parts.length - 2] || null
}

export function startThemeWatcher(themesPath: string, intervalMs: number = 1000): void {
    if (!nativeModule) {
        logger.main.warn('pulsesyncNative addon not loaded. startThemeWatcher will not watch files.')
        return
    }
    logger.main.info(`Starting native watcher on ${themesPath} with interval ${intervalMs}ms`)
    nativeModule.watch(themesPath, intervalMs, (eventType, filename) => {
        const watchedAddonName = tryExtractAddonNameFromWatchPath(filename)
        if (watchedAddonName) {
            sendAddonSettings({ addonName: watchedAddonName, force: true })
            return
        }
        if (handleSettingsFilenames.has(path.basename(path.normalize(filename)).toLowerCase())) {
            sendAllAddonSettings({ force: true })
            return
        }

        switch (eventType) {
            case 'add':
                logger.main.info(`File ${filename} has been added`)
                scheduleAddonRefresh()
                break
            case 'change':
                logger.main.info(`File ${filename} has been changed`)
                scheduleAddonRefresh()
                break
            case 'unlink':
                logger.main.info(`File ${filename} has been removed`)
                scheduleAddonRefresh()
                break
            default:
                logger.main.warn(`Unknown event ${eventType} on ${filename}`)
        }
    })
}

export const nativeGetHardwareIdentity = (): { hash: string; source: string; algorithm: 'sha256' } | null => {
    if (!nativeModule) return null
    try {
        return nativeModule.getHardwareIdentity()
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeGetHardwareIdentity: ${err}`)
        return null
    }
}

export const nativeReadFile = (filePath: string): Buffer | null => {
    if (!nativeModule) return null
    try {
        return nativeModule.readFile(filePath)
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeReadFile for '${filePath}': ${err}`)
        return null
    }
}

export const nativeDeleteFile = (filePath: string): boolean => {
    if (!nativeModule) return false
    try {
        nativeModule.deleteFile(filePath)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeDeleteFile for '${filePath}': ${err}`)
        return false
    }
}

export const nativeRenameFile = (oldPath: string, newPath: string): boolean => {
    if (!nativeModule) return false
    try {
        nativeModule.renameFile(oldPath, newPath)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeRenameFile from '${oldPath}' to '${newPath}': ${err}`)
        return false
    }
}

export const nativeMoveFile = (source: string, destination: string): boolean => {
    if (!nativeModule) return false
    try {
        nativeModule.moveFile(source, destination)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeMoveFile from '${source}' to '${destination}': ${err}`)
        return false
    }
}

export const nativeCopyFile = (source: string, destination: string): boolean => {
    if (!nativeModule) return false
    try {
        nativeModule.copyFile(source, destination)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeCopyFile from '${source}' to '${destination}': ${err}`)
        return false
    }
}

export const nativeFileExists = (filePath: string): boolean => {
    if (!nativeModule) return false
    try {
        return nativeModule.fileExists(filePath)
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeFileExists for '${filePath}': ${err}`)
        return false
    }
}

export const nativeCalculateAsarHeaderHash = (filePath: string): string => {
    if (!nativeModule) throw new Error('pulsesyncNative addon is not available')
    return nativeModule.calculateAsarHeaderHash(filePath)
}

export const nativePatchWindowsIntegrity = (exePath: string, asarPath: string): string => {
    if (!nativeModule) throw new Error('pulsesyncNative addon is not available')
    return nativeModule.patchWindowsIntegrity(exePath, asarPath)
}

export const nativeReadAsarVersion = (filePath: string): string => {
    if (!nativeModule) throw new Error('pulsesyncNative addon is not available')
    return nativeModule.readAsarVersion(filePath)
}

export const nativePatchMacIntegrity = (appBundlePath: string, asarPath: string, entitlementsPath: string): string => {
    if (!nativeModule) throw new Error('pulsesyncNative addon is not available')
    return nativeModule.patchMacIntegrity(appBundlePath, asarPath, entitlementsPath)
}

export default { pulsesyncNative: nativeModule }
