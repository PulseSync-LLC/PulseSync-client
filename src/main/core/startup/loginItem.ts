import { app } from 'electron'

import logger from '../../shared/logger'
import { LOGIN_STARTUP_ARGUMENT } from '../../shared/startupVisibility'
import isAppDev from '../../shared/utils/isAppDev'

export function setAutoStartEnabled(enabled: boolean, enabledInSystem = enabled): void {
    if (isAppDev || process.platform === 'linux') return
    app.setLoginItemSettings({
        openAtLogin: enabled,
        path: app.getPath('exe'),
        ...(process.platform === 'win32' ? { args: [LOGIN_STARTUP_ARGUMENT], enabled: enabledInSystem } : {}),
    })
}

export function refreshAutoStartRegistration(): void {
    if (isAppDev || process.platform !== 'win32') return
    try {
        const settings = app.getLoginItemSettings({ path: app.getPath('exe') })
        if (settings.openAtLogin) setAutoStartEnabled(true, settings.executableWillLaunchAtLogin)
    } catch (error) {
        logger.main.warn('Failed to refresh autostart registration:', error)
    }
}
