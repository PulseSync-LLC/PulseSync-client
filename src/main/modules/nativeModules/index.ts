import isAppDev from 'electron-is-dev'
import path from 'path'
import fs from 'fs'
import logger from '../logger'
import { app } from 'electron'
import { sendAddon } from '../httpServer'

declare const __non_vite_require__: (moduleId: string) => any

interface FileOperationsAddon {
    watch(target: string, intervalMs: number, callback: (eventType: string, filename: string) => void): void
    readFile(target: string): Buffer
    deleteFile(target: string): void
    renameFile(oldPath: string, newPath: string): void
    moveFile(src: string, dest: string): void
    fileExists(target: string): boolean
}

interface NativeModules {
    fileOperations?: FileOperationsAddon
    [addonName: string]: any
}

const loadNativeModules = (): NativeModules => {
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
                    modules[addonName] = __non_vite_require__(fullPath)
                    logger.nativeModuleManager.info(`Loaded native module '${addonName}' from ${fullPath}`)
                } catch (err) {
                    logger.nativeModuleManager.error(`Failed to load native module '${addonName}': ${err}`)
                }
            }
        })
    }

    try {
        scanDir(baseDir)
    } catch (err) {
        logger.nativeModuleManager.error(`Error scanning native modules directory: ${err}`)
    }

    if (Object.keys(modules).length === 0) {
        logger.nativeModuleManager.warn('No native modules available.')
    }

    return modules
}

const nativeModules = loadNativeModules()

export function startThemeWatcher(themesPath: string, intervalMs: number = 1000): void {
    const addon = nativeModules['fileOperations'] as FileOperationsAddon | undefined
    if (!addon) {
        logger.main.warn('fileOperations addon not loaded. startThemeWatcher will not watch files.')
        return
    }
    logger.main.info(`Starting native watcher on ${themesPath} with interval ${intervalMs}ms`)
    addon.watch(themesPath, intervalMs, (eventType, filename) => {
        switch (eventType) {
            case 'add':
                logger.main.info(`File ${filename} has been added`)
                sendAddon(true)
                break
            case 'change':
                logger.main.info(`File ${filename} has been changed`)
                sendAddon(true)
                break
            case 'unlink':
                logger.main.info(`File ${filename} has been removed`)
                sendAddon(true)
                break
            default:
                logger.main.warn(`Unknown event ${eventType} on ${filename}`)
        }
    })
}

export const nativeReadFile = (filePath: string): Buffer | null => {
    const addon = nativeModules['fileOperations'] as FileOperationsAddon | undefined
    if (!addon) {
        logger.nativeModuleManager.warn('fileOperations addon not loaded. nativeReadFile will return null.')
        return null
    }
    try {
        return addon.readFile(filePath)
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeReadFile for '${filePath}': ${err}`)
        return null
    }
}

export const nativeDeleteFile = (filePath: string): boolean => {
    const addon = nativeModules['fileOperations'] as FileOperationsAddon | undefined
    if (!addon) {
        logger.nativeModuleManager.warn('fileOperations addon not loaded. nativeDeleteFile will be a no-op.')
        return false
    }
    try {
        addon.deleteFile(filePath)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeDeleteFile for '${filePath}': ${err}`)
        return false
    }
}

export const nativeRenameFile = (oldPath: string, newPath: string): boolean => {
    const addon = nativeModules['fileOperations'] as FileOperationsAddon | undefined
    if (!addon) {
        logger.nativeModuleManager.warn('fileOperations addon not loaded. nativeRenameFile will be a no-op.')
        return false
    }
    try {
        addon.renameFile(oldPath, newPath)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeRenameFile from '${oldPath}' to '${newPath}': ${err}`)
        return false
    }
}

export const nativeMoveFile = (src: string, dest: string): boolean => {
    const addon = nativeModules['fileOperations'] as FileOperationsAddon | undefined
    if (!addon) {
        logger.nativeModuleManager.warn('fileOperations addon not loaded. nativeMoveFile will be a no-op.')
        return false
    }
    try {
        addon.moveFile(src, dest)
        return true
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeMoveFile from '${src}' to '${dest}': ${err}`)
        return false
    }
}

export const nativeFileExists = (filePath: string): boolean => {
    const addon = nativeModules['fileOperations'] as FileOperationsAddon | undefined
    if (!addon) {
        logger.nativeModuleManager.warn('fileOperations addon not loaded. nativeFileExists will return false.')
        return false
    }
    try {
        return addon.fileExists(filePath)
    } catch (err) {
        logger.nativeModuleManager.error(`Error in nativeFileExists for '${filePath}': ${err}`)
        return false
    }
}

export default nativeModules as NativeModules
