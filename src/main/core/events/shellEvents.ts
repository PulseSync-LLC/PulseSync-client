import { randomUUID } from 'node:crypto'
import os from 'node:os'

import { app, dialog, ipcMain, shell } from 'electron'

import * as fsp from 'fs/promises'
import path from 'path'

import MainEvents from '@common/types/mainEvents'

import logger from '../../shared/logger'
import { isMac } from '../utils/appUtils'

const allowedExternalProtocols = new Set(['http:', 'https:', 'yandexmusic:'])

const isSafeExternalUrl = (rawUrl: string): boolean => {
    try {
        const url = new URL(rawUrl)
        return allowedExternalProtocols.has(url.protocol)
    } catch {
        return false
    }
}

const resolveWithinBase = (baseDir: string, target: string): string | null => {
    const resolved = path.resolve(baseDir, target)
    const normalizedBase = path.resolve(baseDir)
    if (resolved === normalizedBase) return resolved
    return resolved.startsWith(normalizedBase + path.sep) ? resolved : null
}

export const registerShellEvents = (): void => {
    ipcMain.on(MainEvents.OPEN_EXTERNAL, async (_event, url: string) => {
        try {
            if (!isSafeExternalUrl(url)) {
                logger.main.warn(`Blocked opening external URL: ${url}`)
                return
            }
            await shell.openExternal(url)
        } catch (error) {
            logger.main.error('Error opening external URL:', error)
        }
    })

    ipcMain.on(MainEvents.OPEN_FILE, (_event, markdownContent: string) => {
        const tempFilePath = path.join(os.tmpdir(), `terms-${randomUUID()}.md`)
        fsp.writeFile(tempFilePath, markdownContent, { flag: 'wx' })
            .then(async () => {
                const openError = await shell.openPath(tempFilePath)
                if (openError) {
                    logger.main.error(`Error opening the file: ${openError}`)
                }
                setTimeout(async () => {
                    try {
                        await fsp.unlink(tempFilePath)
                        logger.main.log('Temporary file successfully deleted')
                    } catch (unlinkErr: any) {
                        if (unlinkErr?.code !== 'ENOENT') {
                            logger.main.error('Error deleting the file:', unlinkErr)
                        }
                    }
                }, 10000)
            })
            .catch(err => {
                logger.main.error('Error writing to file:', err)
            })
    })

    ipcMain.on(MainEvents.OPEN_PATH, async (_event, data: any) => {
        switch (data.action) {
            case 'openApplications': {
                await shell.openPath('/Applications')
                break
            }
            case 'openPath': {
                if (typeof data.path === 'string' && data.path.trim().length > 0) {
                    await shell.openPath(data.path)
                }
                break
            }
            case 'appPath': {
                const appPath = app.getAppPath()
                const pulseSyncPath = path.resolve(appPath, '../..')
                await shell.openPath(pulseSyncPath)
                break
            }
            case 'musicPath': {
                const musicDir = app.getPath('music')
                const downloadDir = path.join(musicDir, 'PulseSyncMusic')
                await shell.openPath(downloadDir)
                break
            }
            case 'addonsPath': {
                const themesFolderPath = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                await shell.openPath(themesFolderPath)
                break
            }
            case 'theme': {
                const addonsRoot = path.join(app.getPath('appData'), 'PulseSync', 'addons')
                const safeThemePath = resolveWithinBase(addonsRoot, data.themeName || '')
                if (!safeThemePath) {
                    logger.main.warn(`Blocked opening theme path: ${data.themeName}`)
                    break
                }
                await shell.openPath(safeThemePath)
                break
            }
            case 'obsWidgetPath': {
                const widgetPath = path.join(app.getPath('appData'), 'PulseSync', 'obs-widget')
                await shell.openPath(widgetPath)
                break
            }
            case 'privacySettings': {
                if (isMac()) {
                    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy')
                }
                break
            }
        }
    })

    ipcMain.handle(MainEvents.DIALOG_OPEN_DIRECTORY, async (_evt, opts?: { defaultPath?: string }) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: opts?.defaultPath,
        })
        if (canceled || !filePaths.length) return null
        return path.normalize(filePaths[0])
    })
}
