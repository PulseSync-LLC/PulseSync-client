import { BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'original-fs'
import * as fsp from 'fs/promises'
import axios from 'axios'
import AdmZip from 'adm-zip'
import MainEvents from '../../../common/types/mainEvents'
import RendererEvents, { RendererEvent } from '../../../common/types/rendererEvents'
import logger from '../logger'
import { OBS_WIDGET_RELEASE_URL } from '../../constants/urls'
import { sendProgress, sendToRenderer } from '../mod/download.helpers'

const WIDGET_INSTALL_DIR = (app: any) => path.join(app.getPath('appData'), 'PulseSync', 'obs-widget')

const cleanupTempZip = async (tempZipPath: string | null) => {
    if (!tempZipPath || !fs.existsSync(tempZipPath)) return
    try {
        await fsp.unlink(tempZipPath)
    } catch (unlinkError) {
        logger.main.warn('Failed to delete temp file:', unlinkError)
    }
}

const sendWidgetFailure = (window: BrowserWindow, channel: RendererEvent, error: any, fallback: string) => {
    const message = error?.message || fallback
    sendToRenderer(window, channel, { error: message })
}

const fetchLatestReleaseUrl = async (): Promise<string> => {
    try {
        const response = await axios.get(OBS_WIDGET_RELEASE_URL)
        const { assets } = response.data

        if (!assets?.length) {
            throw new Error('No assets found in the latest release')
        }

        const zipAsset = assets.find((asset: any) => asset.name.endsWith('.zip'))
        if (!zipAsset) {
            throw new Error('No .zip file found in the latest release')
        }

        return zipAsset.browser_download_url
    } catch (error: any) {
        logger.main.error('Error fetching latest release:', error)
        throw new Error(`Failed to fetch latest release: ${error.message}`)
    }
}

const downloadWidget = async (window: BrowserWindow, downloadUrl: string, installDir: string): Promise<boolean> => {
    let tempZipPath: string | null = null
    try {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: 'Скачивание виджета OBS...' })
        logger.main.info(`Downloading widget from: ${downloadUrl}`)

        await fsp.mkdir(installDir, { recursive: true })
        tempZipPath = path.join(installDir, 'widget.zip')

        const response = await axios.get(downloadUrl, { responseType: 'stream' })
        const totalLength = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedLength = 0

        const writer = fs.createWriteStream(tempZipPath)

        response.data.on('data', (chunk: Buffer) => {
            downloadedLength += chunk.length
            const progress = Math.round((downloadedLength / totalLength) * 100)
            sendProgress(window, progress)
        })

        await new Promise<void>((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
            response.data.pipe(writer)
        })

        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: 'Распаковка архива...' })
        logger.main.info('Extracting widget archive')

        const zip = new AdmZip(tempZipPath)
        zip.extractAllTo(installDir, true)

        await cleanupTempZip(tempZipPath)
        tempZipPath = null

        logger.main.info('Widget downloaded and extracted successfully')
        return true
    } catch (error: any) {
        logger.main.error('Error downloading widget:', error)

        await cleanupTempZip(tempZipPath)
        sendWidgetFailure(window, RendererEvents.DOWNLOAD_OBS_WIDGET_FAILURE, error, 'Error downloading widget')
        return false
    }
}

const removeWidget = async (window: BrowserWindow, installDir: string): Promise<boolean> => {
    try {
        sendToRenderer(window, RendererEvents.UPDATE_MESSAGE, { message: 'Удаление виджета OBS...' })
        logger.main.info(`Removing widget from: ${installDir}`)

        if (!fs.existsSync(installDir)) {
            logger.main.info('Widget directory does not exist, nothing to remove')
            return true
        }

        await fsp.rm(installDir, { recursive: true, force: true })
        logger.main.info('Widget removed successfully')
        return true
    } catch (error: any) {
        logger.main.error('Error removing widget:', error)
        sendWidgetFailure(window, RendererEvents.REMOVE_OBS_WIDGET_FAILURE, error, 'Error removing widget')
        return false
    }
}

export const obsWidgetManager = (window: BrowserWindow, app: any): void => {
    const widgetInstallDir = WIDGET_INSTALL_DIR(app)

    ipcMain.on(MainEvents.DOWNLOAD_OBS_WIDGET, async () => {
        try {
            const downloadUrl = await fetchLatestReleaseUrl()
            const success = await downloadWidget(window, downloadUrl, widgetInstallDir)

            if (success) {
                sendToRenderer(window, RendererEvents.DOWNLOAD_OBS_WIDGET_SUCCESS, { message: 'Виджет OBS успешно установлен' })
                logger.main.info('OBS Widget installation completed successfully')
            }
        } catch (error: any) {
            logger.main.error('OBS Widget download failed:', error)
            sendWidgetFailure(window, RendererEvents.DOWNLOAD_OBS_WIDGET_FAILURE, error, 'Неизвестная ошибка при скачивании виджета')
        }
    })

    ipcMain.on(MainEvents.REMOVE_OBS_WIDGET, async () => {
        try {
            const success = await removeWidget(window, widgetInstallDir)

            if (success) {
                sendToRenderer(window, RendererEvents.REMOVE_OBS_WIDGET_SUCCESS, { message: 'Виджет OBS успешно удален' })
                logger.main.info('OBS Widget removal completed successfully')
            }
        } catch (error: any) {
            logger.main.error('OBS Widget removal failed:', error)
            sendWidgetFailure(window, RendererEvents.REMOVE_OBS_WIDGET_FAILURE, error, 'Неизвестная ошибка при удалении виджета')
        }
    })

    ipcMain.handle(MainEvents.CHECK_OBS_WIDGET_INSTALLED, async () => {
        try {
            const exists = fs.existsSync(widgetInstallDir)
            logger.main.info(`OBS Widget check: ${exists ? 'installed' : 'not installed'}`)
            return exists
        } catch (error: any) {
            logger.main.error('Error checking OBS widget installation:', error)
            return false
        }
    })

    ipcMain.handle(MainEvents.GET_OBS_WIDGET_PATH, async () => {
        try {
            logger.main.info(`Returning widget path: ${widgetInstallDir}`)
            return widgetInstallDir
        } catch (error: any) {
            logger.main.error('Error getting OBS widget path:', error)
            return ''
        }
    })
}
