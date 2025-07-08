import isAppDev from 'electron-is-dev'
import path from 'path'
import fs from 'fs'
import { isWindows } from '../../utils/appUtils'
import logger from '../logger'
import { app } from 'electron'
import { sendAddon } from '../httpServer'

declare const __non_webpack_require__: (moduleId: string) => any

interface CheckAccessAddon {
    isDiscordRunning(): boolean;
    isAnyDiscordElevated(): boolean;
    isProcessRunning(target: string): boolean;
    isProcessElevated(target: string): boolean;
}

interface FileWatcherAddon {
    watch(target: string, intervalMs: number, callback: (eventType: string, filename: string) => void): void;
}

interface NativeModules {
    checkAccess?: CheckAccessAddon;
    fileWatcher?: FileWatcherAddon;
    [addonName: string]: any;
}

const loadNativeModules = (): NativeModules => {
    if (!isWindows()) {
        logger.nativeModuleManager.info('Skipping native modules on non-Windows.')
        return {}
    }

    const baseDir = isAppDev ? path.resolve(process.cwd(), 'nativeModules') : path.join(app.getPath('exe'), '..', 'modules')

    logger.nativeModuleManager.info(`Scanning native modules directory: ${baseDir}`)

    const modules: NativeModules = {}

    const scanDir = (dir: string) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
                scanDir(fullPath)
            } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.node') {
                const relative = path.relative(baseDir, fullPath)
                const parts = relative.split(path.sep)
                const addonName = parts[0]

                logger.nativeModuleManager.info(`Native module found: ${relative}`)
                try {
                    const loaded = __non_webpack_require__(fullPath)
                    modules[addonName] = loaded
                    logger.nativeModuleManager.info(`Loaded native module '${addonName}' from ${fullPath}`)
                } catch (err) {
                    logger.nativeModuleManager.error(`Failed to load native module '${addonName}': ${err}`)
                }
            }
        })
    }

    scanDir(baseDir)
    return modules
}

const nativeModules = loadNativeModules()

if (Object.keys(nativeModules).length === 0) {
    logger.nativeModuleManager.error('No native modules available.')
}

export const isDiscordRunning = (): boolean => {
    const addon = nativeModules['checkAccess'] as CheckAccessAddon | undefined
    if (!addon) {
        throw new Error('checkAccess addon not loaded.')
    }
    return addon.isDiscordRunning()
}

export const isAnyDiscordElevated = (): boolean => {
    const addon = nativeModules['checkAccess'] as CheckAccessAddon | undefined
    if (!addon) {
        throw new Error('checkAccess addon not loaded.')
    }
    return addon.isAnyDiscordElevated()
}

export const isProcessElevated = (name: string): boolean => {
    const addon = nativeModules['checkAccess'] as CheckAccessAddon | undefined;
    if (!addon) {
        logger.nativeModuleManager.error('checkAccess addon not loaded.');
        throw new Error('checkAccess addon not loaded.');
    }
    try {
        return addon.isProcessElevated(name)
    } catch (err) {
        logger.nativeModuleManager.error(`Error checking process elevation: ${err}`);
        return false;
    }
}

export const isProcessRunning = (name: string): boolean => {
    const addon = nativeModules['checkAccess'] as CheckAccessAddon | undefined;
    if (!addon) {
        logger.nativeModuleManager.error('checkAccess addon not loaded.');
        throw new Error('checkAccess addon not loaded.');
    }
    try {
        return addon.isProcessRunning(name)
    } catch (err) {
        logger.nativeModuleManager.error(`Error checking process elevation: ${err}`);
        return false;
    }
}

function watchFile(
    target: string,
    callback: (eventType: string, filename: string) => void,
    intervalMs: number = 1000
): void {
    const addon = nativeModules['fileWatcher'] as FileWatcherAddon | undefined;
    if (!addon) {
        logger.nativeModuleManager.error('fileWatcher addon not loaded.');
        throw new Error('fileWatcher addon not loaded.');
    }
    addon.watch(target, intervalMs, callback);
}

export function startThemeWatcher(
    themesPath: string,
    intervalMs: number = 1000
): void {
    logger.main.info(`Starting native watcher on ${themesPath} with interval ${intervalMs}ms`);

    watchFile(themesPath, (eventType, filename) => {
        switch (eventType) {
            case 'add':
                logger.main.info(`File ${filename} has been added`);
                sendAddon(true);
                break;
            case 'change':
                logger.main.info(`File ${filename} has been changed`);
                sendAddon(true);
                break;
            case 'unlink':
                logger.main.info(`File ${filename} has been removed`);
                sendAddon(true);
                break;
            default:
                logger.main.warn(`Unknown event ${eventType} on ${filename}`);
        }
    }, intervalMs);
}

export default nativeModules as NativeModules
