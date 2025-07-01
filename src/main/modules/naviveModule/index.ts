import isAppDev from 'electron-is-dev'
declare const __non_webpack_require__: (moduleId: string) => any
import path from 'path'
import { isWindows } from '../../utils/appUtils'

const getAddonPath = (): string => {
    if(!isWindows()) return null
    if (isAppDev) {
        return path.resolve(process.cwd(), 'nativeModule', 'checkAccess', 'build', 'Release', 'checkAccessAddon.node')
    }
    return path.join(!isAppDev ? process.resourcesPath : __dirname, 'modules', 'checkAccess', 'checkAccessAddon.node')
}

const addon = __non_webpack_require__(getAddonPath()) as {
    isDiscordRunning: () => boolean
    isAnyDiscordElevated: () => boolean
}

export const isDiscordRunning = (): boolean => addon.isDiscordRunning()
export const isAnyDiscordElevated = (): boolean => addon.isAnyDiscordElevated()
