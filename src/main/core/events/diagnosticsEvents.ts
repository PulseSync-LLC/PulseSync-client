import os from 'node:os'

import { app, ipcMain, shell } from 'electron'

import AdmZip from 'adm-zip'
import fs from 'original-fs'
import path from 'path'
import * as si from 'systeminformation'

import { DESKTOP_CORE_VERSION } from '@common/desktopRuntime/version'
import MainEvents from '@common/types/mainEvents'

import { HandleErrorsElectron } from '../../shared/handlers/handleErrorsElectron'
import { t } from '../../shared/i18n'
import logger from '../../shared/logger'
import { getYandexMusicAppDataPath, getYandexMusicLogsPath } from '../utils/appUtils'

export const registerLoggingEvents = (): void => {
    const formatRendererLogMessage = (prefix: string, payload: Record<string, any> | null | undefined) => {
        const text = payload?.text ?? payload?.message ?? ''
        const details: string[] = []
        const type = payload?.type ? `type=${payload.type}` : null
        if (type) details.push(type)
        if (payload?.stack) details.push(`stack:\n${payload.stack}`)
        if (payload?.componentStack) details.push(`componentStack:\n${payload.componentStack}`)
        const detailText = details.length ? `\n${details.join('\n')}` : ''
        return `[${prefix}] ${text}${detailText}`.trim()
    }

    ipcMain.on(MainEvents.RENDERER_LOG, (_event, data: any) => {
        const message = formatRendererLogMessage('RENDERER_LOG', data)
        const level = data?.error ? 'error' : data?.info ? 'info' : 'log'
        logger.renderer[level](message)
    })

    ipcMain.on(MainEvents.LOG_ERROR, (_event, errorInfo: any) => {
        const message = formatRendererLogMessage('LOG_ERROR', errorInfo)
        logger.renderer.error(message)
        const errorMessage = errorInfo?.message ?? t('main.events.rendererError')
        const error = new Error(errorMessage)
        if (errorInfo?.stack) {
            const componentStack = errorInfo?.componentStack ? `\nComponentStack:\n${errorInfo.componentStack}` : ''
            error.stack = `${errorInfo.stack}${componentStack}`
        }
        HandleErrorsElectron.handleError('renderer-error', errorInfo?.type ?? 'unknown', 'error-boundary', error)
    })
}

export const registerLogArchiveEvent = (): void => {
    ipcMain.on(MainEvents.GET_LOG_ARCHIVE, async () => {
        try {
            const logDirPath = path.join(app.getPath('appData'), 'PulseSync', 'logs')
            const now = new Date()
            const year = now.getFullYear()
            const month = String(now.getMonth() + 1).padStart(2, '0')
            const day = String(now.getDate()).padStart(2, '0')
            const archiveName = `logs-${year}-${month}-${day}.zip`
            const archivePath = path.join(logDirPath, archiveName)
            const userInfo = os.userInfo()
            const gpuData = await si.graphics()

            const systemInfo = {
                appVersion: DESKTOP_CORE_VERSION,
                osType: os.type(),
                osRelease: os.release(),
                cpu: os.cpus(),
                gpu: gpuData.controllers,
                freeMemory: os.freemem(),
                arch: os.arch(),
                platform: os.platform(),
                osInfo: await si.osInfo(),
                memInfo: await si.mem(),
                userInfo: { username: userInfo.username, homedir: userInfo.homedir },
            }

            const systemInfoPath = path.join(logDirPath, 'system-info.json')
            const configPulsePath = path.join(app.getPath('userData'), 'pulsesync_settings.json')
            const configYandexMusicPath = path.join(getYandexMusicAppDataPath(), 'config.json')
            const logsYandexMusicPath = getYandexMusicLogsPath()

            fs.writeFileSync(systemInfoPath, JSON.stringify(systemInfo, null, 4), 'utf-8')

            const zip = new AdmZip()
            zip.addLocalFolder(logDirPath, '', filePath => !filePath.endsWith('.zip') && filePath !== archiveName)
            zip.addLocalFolder(logsYandexMusicPath, 'yandexmusic/logs')
            zip.addLocalFile(configPulsePath, '')
            zip.addLocalFile(configYandexMusicPath, 'yandexmusic/')
            zip.writeZip(archivePath)
            shell.showItemInFolder(archivePath)
        } catch (error: any) {
            logger.main.error(`Error while creating archive file: ${error}`)
        }
    })
}
