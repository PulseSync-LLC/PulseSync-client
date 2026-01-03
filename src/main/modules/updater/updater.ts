import * as semver from 'semver'
import { app, dialog, type BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateCheckResult, type UpdateInfo as ElectronUpdaterUpdateInfo } from 'electron-updater'
import { state } from '../handlers/state'
import RendererEvents from '../../../common/types/rendererEvents'
import { UpdateUrgency } from './constants/updateUrgency'
import { UpdateStatus } from './constants/updateStatus'
import logger from '../logger'
import isAppDev from 'electron-is-dev'
import { mainWindow } from '../createWindow'

type CommonConfig = Record<string, unknown>

type UpdateInfo = ElectronUpdaterUpdateInfo & {
    updateUrgency?: UpdateUrgency
    commonConfig?: CommonConfig
}

type DownloadResult = unknown

type UpdateResult = UpdateCheckResult & {
    updateInfo: UpdateInfo
    downloadPromise?: Promise<DownloadResult>
}

class Updater {
    private latestAvailableVersion: string | null = null
    private updateStatus: UpdateStatus = UpdateStatus.IDLE
    private updaterId: NodeJS.Timeout | null = null
    private onUpdateListeners: Array<(version: string) => void> = []
    private commonConfig: CommonConfig = {}

    constructor() {
        autoUpdater.logger = logger.updater
        autoUpdater.autoRunAppAfterInstall = true
        autoUpdater.autoDownload = true
        autoUpdater.disableWebInstaller = true

        autoUpdater.on('error', (error: unknown) => {
            logger.updater.error('Updater error', error)
            this.setProgressBar(-1)
        })

        autoUpdater.on('checking-for-update', () => {
            logger.updater.log('Checking for update')
        })

        autoUpdater.on(RendererEvents.DOWNLOAD_PROGRESS, (info: ProgressInfo) => {
            this.setProgressBar(info.percent / 100)
            logger.updater.log('Download progress', info.percent)
            this.safeSend(RendererEvents.DOWNLOAD_UPDATE_PROGRESS, info.percent)
        })

        autoUpdater.on('update-downloaded', (updateInfo: UpdateInfo) => {
            logger.updater.log('Update downloaded', updateInfo.version)
            this.setProgressBar(-1)

            if (updateInfo.updateUrgency === UpdateUrgency.HARD) {
                logger.updater.log('This update should be installed now')
                this.install()
                return
            }

            if (this.commonConfig && this.commonConfig.DEPRECATED_VERSIONS !== undefined) {
                try {
                    const deprecatedRange = String(this.commonConfig.DEPRECATED_VERSIONS)
                    const isDeprecatedVersion = semver.satisfies(app.getVersion(), deprecatedRange)
                    if (isDeprecatedVersion) {
                        logger.updater.log('This version is deprecated', app.getVersion(), deprecatedRange)
                        this.install()
                        return
                    }
                } catch (e) {
                    logger.updater.error('Failed to evaluate DEPRECATED_VERSIONS range', e)
                }
            }

            this.latestAvailableVersion = updateInfo.version
            this.onUpdateListeners.forEach(listener => {
                try {
                    listener(updateInfo.version)
                } catch (e) {
                    logger.updater.error('onUpdate listener error', e)
                }
            })
        })
    }

    private getWindow(): BrowserWindow | null {
        const win = mainWindow as unknown as BrowserWindow | undefined
        if (!win) return null
        if (win.isDestroyed()) return null
        return win
    }

    private safeSend(channel: string, ...args: unknown[]) {
        const win = this.getWindow()
        if (!win) return
        try {
            win.webContents.send(channel as any, ...(args as any[]))
        } catch (e) {
            logger.updater.error('Failed to send renderer event', channel, e)
        }
    }

    private setProgressBar(value: number) {
        const win = this.getWindow()
        if (!win) return
        try {
            win.setProgressBar(value)
        } catch (e) {
            logger.updater.error('Failed to set progress bar', e)
        }
    }

    private flashFrame(value: boolean) {
        const win = this.getWindow()
        if (!win) return
        try {
            win.flashFrame(value)
        } catch (e) {
            logger.updater.error('Failed to flash frame', e)
        }
    }

    private mergeCommonConfig(next?: CommonConfig) {
        if (!next) return

        logger.updater.info('Common config', next)
        for (const [key, value] of Object.entries(next)) {
            this.commonConfig[key] = value
            logger.updater.info(`Updated commonConfig: ${key} = ${String(value)}`)
        }
    }

    private updateApplier(updateResult: UpdateResult) {
        const { downloadPromise, updateInfo } = updateResult

        if (updateInfo.updateUrgency !== undefined) {
            logger.updater.info('Urgency', updateInfo.updateUrgency)
        }

        if (updateInfo.commonConfig !== undefined) {
            this.mergeCommonConfig(updateInfo.commonConfig)
        }

        if (!downloadPromise) {
            this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false })
            return
        }

        this.latestAvailableVersion = updateInfo.version

        this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: true })

        logger.updater.info('New version available', app.getVersion(), '->', updateInfo.version)
        this.updateStatus = UpdateStatus.DOWNLOADING

        downloadPromise
            .then(downloadResult => {
                if (!downloadResult) return

                this.updateStatus = UpdateStatus.DOWNLOADED
                logger.updater.info(`Download result: ${String(downloadResult)}`)

                this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FINISHED)
                this.setProgressBar(-1)
                this.flashFrame(true)

                this.safeSend(RendererEvents.UPDATE_APP_DATA, { update: true })
            })
            .catch((error: unknown) => {
                this.updateStatus = UpdateStatus.IDLE
                logger.updater.error('Downloader error', error)
                this.setProgressBar(-1)
                this.safeSend(RendererEvents.DOWNLOAD_UPDATE_FAILED)
            })
    }

    async check(): Promise<UpdateStatus | null> {
        if (process.platform === 'linux' && !process.env.APPIMAGE) {
            logger.updater.info('Auto-update is disabled on Linux without AppImage packaging')
            this.safeSend(RendererEvents.CHECK_UPDATE, { updateAvailable: false })
            return null
        }
        if (this.updateStatus !== UpdateStatus.IDLE) {
            logger.updater.log('New update is processing', this.updateStatus)

            if (this.updateStatus === UpdateStatus.DOWNLOADED && this.latestAvailableVersion) {
                this.safeSend(RendererEvents.UPDATE_AVAILABLE, this.latestAvailableVersion)
                this.flashFrame(true)
            }

            return this.updateStatus
        }

        try {
            const updateResult = (await autoUpdater.checkForUpdatesAndNotify({
                title: 'Новое обновление готово к установке',
                body: `PulseSync версия {version} успешно скачана и будет установлена автоматически при выходе из приложения`,
            })) as UpdateResult | null

            if (!updateResult) {
                logger.updater.log('Обновлений не найдено')
                return null
            }

            this.updateApplier(updateResult)
        } catch (error: unknown) {
            const e = error as any
            if (e?.code === 'ENOENT' && typeof e?.path === 'string' && e.path.endsWith('app-update.yml')) {
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
        if (this.updaterId) return
        this.check()
        this.updaterId = setInterval(() => {
            this.check()
        }, 900000)
    }

    stop() {
        if (!this.updaterId) return
        clearInterval(this.updaterId)
        this.updaterId = null
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
