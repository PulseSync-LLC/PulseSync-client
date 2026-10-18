import { app } from 'electron'

export const LOGIN_STARTUP_ARGUMENT = '--pulsesync-autostart'

export function getStartupArguments(): string[] {
    const argv = process.argv.slice(1)
    if (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin && !argv.includes(LOGIN_STARTUP_ARGUMENT)) {
        argv.push(LOGIN_STARTUP_ARGUMENT)
    }
    return argv
}

interface StartupVisibilitySettings {
    autoStartInTray?: boolean
    openWindowOnManualLaunch?: boolean
}

export function shouldStartInTray(settings: StartupVisibilitySettings, argv: readonly string[] = process.argv): boolean {
    if (!settings.autoStartInTray) return false
    if (!settings.openWindowOnManualLaunch) return true
    if (argv.includes(LOGIN_STARTUP_ARGUMENT) || process.argv.includes(LOGIN_STARTUP_ARGUMENT)) return true
    return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
}
