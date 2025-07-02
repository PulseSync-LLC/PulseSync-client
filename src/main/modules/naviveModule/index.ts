import isAppDev from 'electron-is-dev'
import path from 'path'
import { isWindows } from '../../utils/appUtils'
import logger from '../logger'
import { app } from 'electron'

declare const __non_webpack_require__: (moduleId: string) => any

const getAddonPath = (): string | null => {
    if (!isWindows()) {
        logger.nativeModuleManager.info('Skipping native module on non-Windows.')
        return null
    }
    const p = isAppDev
        ? path.resolve(process.cwd(), 'nativeModule', 'checkAccess', 'build', 'Release', 'checkAccessAddon.node')
        : path.join(app.getPath('exe'), '..', 'modules', 'checkAccess', 'checkAccessAddon.node')
    logger.nativeModuleManager.info(`Native module path: ${p}`)
    return p
}

const addonPath = getAddonPath()
if (!addonPath) {
    logger.nativeModuleManager.error('checkAccess module unavailable.')
    throw new Error('checkAccess addon not available.')
}

logger.nativeModuleManager.info(`Loading native module: ${addonPath}`)
const addon = __non_webpack_require__(addonPath) as {
    isDiscordRunning: () => boolean
    isAnyDiscordElevated: () => boolean
}

export const isDiscordRunning = (): boolean => {
    return addon.isDiscordRunning()
}

export const isAnyDiscordElevated = (): boolean => {
    return addon.isAnyDiscordElevated()
}
