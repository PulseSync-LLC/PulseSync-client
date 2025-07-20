import * as semver from 'semver'
import { app, dialog } from 'electron'
import { autoUpdater, ProgressInfo } from 'electron-updater'
import { state } from '../handlers/state'
import { UpdateUrgency } from './constants/updateUrgency'
import { UpdateStatus } from './constants/updateStatus'
import logger from '../logger'
import isAppDev from 'electron-is-dev'
import { mainWindow } from '../createWindow'

type UpdateInfo = {
    version: string
    updateUrgency?: UpdateUrgency
    commonConfig?: any
}

type DownloadResult = any

type UpdateResult = {
    downloadPromise?: Promise<DownloadResult>
    updateInfo: UpdateInfo
}

class Updater {
    private latestAvailableVersion: string | null = null
    private updateStatus: UpdateStatus = UpdateStatus.IDLE
    private updaterId: NodeJS.Timeout | null = null
    private onUpdateListeners: Array<(version: string) => void> = []
    private commonConfig: any

    constructor() {
        this.commonConfig = this.commonConfig || {}
        autoUpdater.logger = logger.updater
        autoUpdater.autoRunAppAfterInstall = true
        autoUpdater.autoDownload = true
        autoUpdater.disableWebInstaller = true
        autoUpdater.on('error', error => {
            logger.updater.error('Updater error', error)
        })

        autoUpdater.on('checking-for-update', () => {
            logger.updater.log('Checking for update')
        })
        autoUpdater.on('download-progress', (info: ProgressInfo) => {
            mainWindow.setProgressBar(info.percent / 100)
            logger.updater.log('Download progress', info.percent)
            mainWindow.webContents.send('download-update-progress', info.percent)
        })
        autoUpdater.on('update-downloaded', (updateInfo: UpdateInfo) => {
            logger.updater.log('Update downloaded', updateInfo.version)
            mainWindow.setProgressBar(-1)
            if (updateInfo.updateUrgency === UpdateUrgency.HARD) {
                logger.updater.log('This update should be installed now')
                this.install()
                return
            }

            if (this.commonConfig && this.commonConfig.DEPRECATED_VERSIONS) {
                const isDeprecatedVersion = semver.satisfies(app.getVersion(), this.commonConfig.DEPRECATED_VERSIONS)
                if (isDeprecatedVersion) {
                    logger.updater.log('This version is deprecated', app.getVersion(), this.commonConfig.DEPRECATED_VERSIONS)
                    this.install()
                    return
                }
            }

            this.latestAvailableVersion = updateInfo.version
            this.onUpdateListeners.forEach(listener => listener(updateInfo.version))
        })
    }

    private updateApplier(updateResult: UpdateResult) {
        const { downloadPromise, updateInfo } = updateResult

        if (updateInfo.updateUrgency !== undefined) {
            logger.updater.info('Urgency', updateInfo.updateUrgency)
        }

        if (updateInfo.commonConfig !== undefined) {
            logger.updater.info('Common config', updateInfo.commonConfig)
            for (const key in updateInfo.commonConfig) {
                if (updateInfo.commonConfig.hasOwnProperty(key)) {
                    if (!this.commonConfig) {
                        this.commonConfig = {}
                    }
                    this.commonConfig[key] = updateInfo.commonConfig[key]
                    logger.updater.info(`Updated commonConfig: ${key} = ${updateInfo.commonConfig[key]}`)
                }
            }
        }

        if (!downloadPromise) {
            mainWindow.webContents.send('check-update', {
                updateAvailable: false,
            })
            return
        } else {
            mainWindow.webContents.send('check-update', {
                updateAvailable: true,
            })
        }

        logger.updater.info('New version available', app.getVersion(), '->', updateInfo.version)
        this.updateStatus = UpdateStatus.DOWNLOADING

        downloadPromise
            .then(downloadResult => {
                if (downloadResult) {
                    this.updateStatus = UpdateStatus.DOWNLOADED
                    logger.updater.info(`Download result: ${downloadResult}`)
                    mainWindow.webContents.send('download-update-finished')
                    mainWindow.setProgressBar(-1)
                    mainWindow.flashFrame(true)
                    mainWindow.webContents.send('UPDATE_APP_DATA', {
                        update: true,
                    })
                }
            })
            .catch(error => {
                this.updateStatus = UpdateStatus.IDLE
                logger.updater.error('Downloader error', error)
                mainWindow.setProgressBar(-1)
                mainWindow.webContents.send('download-update-failed')
            })
    }

    async check(): Promise<UpdateStatus> {
        if (this.updateStatus !== UpdateStatus.IDLE) {
            logger.updater.log('New update is processing', this.updateStatus)
            if (this.updateStatus === UpdateStatus.DOWNLOADED) {
                mainWindow.webContents.send('update-available', this.latestAvailableVersion)
                mainWindow.flashFrame(true)
            }
            return this.updateStatus
        }

        try {
            const updateResult = await autoUpdater.checkForUpdatesAndNotify({
                title: 'Новое обновление готово к установке',
                body: `PulseSync версия {version} успешно скачана и будет установлена автоматически при выходе из приложения`,
            })
            if (!updateResult) {
                logger.updater.log('Обновлений не найдено')
                return null
            }
            this.updateApplier(updateResult)
        } catch (error) {
            if (error.code === 'ENOENT' && error.path && error.path.endsWith('app-update.yml')) {
                if (!isAppDev) {
                    logger.updater.error(`File app-update.yml not found.`, error)
                    dialog.showErrorBox('Ошибка', 'Файлы приложения повреждены. Переустановите приложение.')
                    app.quit()
                }
            } else {
                logger.updater.error('Error: checking for updates', error)
            }
        }
        return this.updateStatus
    }

    start() {
        this.check()
        this.updaterId = setInterval(() => {
            this.check()
        }, 900000)
    }

    stop() {
        if (this.updaterId) {
            clearInterval(this.updaterId)
        }
    }

    onUpdate(listener: (version: string) => void) {
        this.onUpdateListeners.push(listener)
    }

    install() {
        logger.updater.info('Installing a new version', this.latestAvailableVersion)
        state.willQuit = true
        autoUpdater.quitAndInstall(true, true)
    }
}
exports.Updater = Updater
export const getUpdater = (() => {
    let updater: Updater | undefined
    return () => {
        if (!updater) {
            updater = new Updater()
        }
        return updater
    }
})()
