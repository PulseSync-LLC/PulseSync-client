import { type FSWatcher, watch } from 'node:fs'

import path from 'path'

import { HANDLE_EVENTS_FILENAME, HANDLE_EVENTS_SETTINGS_FILENAME } from '@common/addons/handleEvents'

import logger from '../../shared/logger'
import { sendAddon, sendAddonSettings, sendAllAddonSettings, sendExtensions } from '../httpServer'
import { loadPulseSyncNative } from './pulsesyncNative'

const nativeModule = loadPulseSyncNative()
if (nativeModule) {
    logger.nativeModuleManager.info(`Loaded pulsesyncNative v${nativeModule.nativeVersion()}`)
} else {
    logger.nativeModuleManager.error('pulsesyncNative addon was not found')
}

const handleSettingsFilenames = new Set([HANDLE_EVENTS_FILENAME.toLowerCase(), HANDLE_EVENTS_SETTINGS_FILENAME.toLowerCase()])
const ADDON_REFRESH_DEBOUNCE_MS = 250
const ADDON_WATCH_RECHECK_MS = 30_000
let addonRefreshTimer: ReturnType<typeof setTimeout> | null = null
let themeWatcher: FSWatcher | null = null
let themeWatcherRetryTimer: ReturnType<typeof setInterval> | null = null
const nativeWatchedRoots = new Set<string>()

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
    themeWatcher?.close()
    themeWatcher = null
    if (themeWatcherRetryTimer) clearInterval(themeWatcherRetryTimer)
    const onChange = (eventType: string, filename: string) => {
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
    }
    const connectWatcher = () => {
        if (themeWatcher) return
        try {
            const watcher = watch(themesPath, { recursive: true, persistent: false }, (eventType, filename) => {
                if (!filename) {
                    sendAllAddonSettings({ force: true })
                    scheduleAddonRefresh()
                    return
                }
                const target = path.join(themesPath, filename)
                const basename = path.basename(target).toLowerCase()
                if (
                    eventType === 'rename' ||
                    ['.js', '.css', '.wasm'].includes(path.extname(target).toLowerCase()) ||
                    handleSettingsFilenames.has(basename) ||
                    basename === 'metadata.json' ||
                    basename === 'modules.local.json'
                ) {
                    onChange('change', target)
                }
            })
            watcher.on('error', error => {
                watcher.close()
                if (themeWatcher === watcher) themeWatcher = null
                logger.main.warn('Addon filesystem watcher failed; retrying with the next recheck:', error)
            })
            watcher.on('close', () => {
                if (themeWatcher === watcher) themeWatcher = null
            })
            themeWatcher = watcher
        } catch (error) {
            logger.main.warn('Addon filesystem watcher unavailable:', error)
        }
    }
    connectWatcher()
    const recheckMs = Math.max(ADDON_WATCH_RECHECK_MS, intervalMs)
    themeWatcherRetryTimer = setInterval(connectWatcher, recheckMs)
    themeWatcherRetryTimer.unref()
    const root = path.resolve(themesPath)
    if (nativeModule && !nativeWatchedRoots.has(root)) {
        nativeModule.watch(root, recheckMs, onChange)
        nativeWatchedRoots.add(root)
    }
    logger.main.info(`Watching addons using filesystem events with a ${recheckMs}ms recheck`)
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
