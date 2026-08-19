import fs from 'node:fs'
import path from 'node:path'

import { app, shell } from 'electron'

type WindowsShortcutRepairOptions = {
    appUserModelId: string
    installRoot: string
    launcher: string
}

function samePath(left: string | undefined, right: string): boolean {
    if (!left) return false
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function shortcutPaths(): string[] {
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    return [
        path.join(app.getPath('desktop'), 'PulseSync.lnk'),
        path.join(programs, 'PulseSync.lnk'),
        path.join(programs, 'PulseSync', 'PulseSync.lnk'),
    ]
}

export function repairWindowsShortcuts(options: WindowsShortcutRepairOptions): void {
    if (process.platform !== 'win32') return

    for (const shortcutPath of shortcutPaths()) {
        if (!fs.existsSync(shortcutPath)) continue

        try {
            const current = shell.readShortcutLink(shortcutPath)
            if (
                samePath(current.target, options.launcher) &&
                samePath(current.cwd, options.installRoot) &&
                samePath(current.icon, options.launcher) &&
                current.appUserModelId === options.appUserModelId &&
                !current.args
            ) {
                continue
            }

            const updated = shell.writeShortcutLink(shortcutPath, 'update', {
                ...current,
                appUserModelId: options.appUserModelId,
                args: '',
                cwd: options.installRoot,
                icon: options.launcher,
                iconIndex: 0,
                target: options.launcher,
            })
            if (!updated) console.warn('Failed to repair PulseSync shortcut', { shortcutPath })
        } catch (error) {
            console.warn('Failed to inspect or repair PulseSync shortcut', { error, shortcutPath })
        }
    }
}
