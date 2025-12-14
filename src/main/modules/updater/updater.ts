import * as semver from 'semver'
import { app, dialog } from 'electron'
import { autoUpdater, ProgressInfo, UpdateCheckResult, UpdateInfo as ElectronUpdateInfo } from 'electron-updater'
import { state } from '../handlers/state'
import Events from '../../../common/types/rendererEvents'
import { UpdateUrgency } from './constants/updateUrgency'
import { UpdateStatus } from './constants/updateStatus'
import logger from '../logger'
import isAppDev from 'electron-is-dev'
import { mainWindow } from '../createWindow'

type ExtendedUpdateInfo = ElectronUpdateInfo & {
    updateUrgency?: UpdateUrgency
    commonConfig?: Record<string, any>
}

type ExtendedUpdateCheckResult = Omit<UpdateCheckResult, 'updateInfo'> & {
    updateInfo: ExtendedUpdateInfo
}

class Updater {
    private latestAvailableVersion: string | null = null
    private updateStatus: UpdateStatus = UpdateStatus.IDLE
    private updaterId: NodeJS.Timeout | null = null
    private onUpdateListeners: Array<(version: string) => void> = []
    private commonConfig: Record<string, any> = {}
    private isChecking = false
    private isDisposed = false

    constructor() {
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

        autoUpdater.on(Events.DOWNLOAD_PROGRESS, (info: ProgressInfo) => {
            this.safeSetProgressBar(info.percent / 100)
            logger.updater.log('Download progress', info.percent)
            this.safeSend(Events.DOWNLOAD_UPDATE_PROGRESS, info.percent)
        })

        autoUpdater.on('update-not-available', () => {
            logger.updater.log('No updates available')
            this.safeSend(Events.CHECK_UPDATE, { updateAvailable: false })
        })

        autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
            logger.updater.log('Update available', info?.version)
            if (info?.version) {
                this.latestAvailableVersion = info.version
            }
            this.safeSend(Events.CHECK_UPDATE, { updateAvailable: true })
        })

        autoUpdater.on('update-downloaded', (rawInfo: ElectronUpdateInfo) => {
            const updateInfo = rawInfo as ExtendedUpdateInfo

            logger.updater.log('Update downloaded', updateInfo.version)

            this.latestAvailableVersion = updateInfo.version
            this.updateStatus = UpdateStatus.DOWNLOADED

            this.safeSetProgressBar(-1)

            if (updateInfo.updateUrgency === UpdateUrgency.HARD) {
                logger.updater.log('This update should be installed now (HARD)')
                this.install()
                return
            }

            if (updateInfo.commonConfig !== undefined) {
                this.applyCommonConfig(updateInfo.commonConfig)
            }

            if (this.commonConfig?.DEPRECATED_VERSIONS) {
                const deprecatedRange = this.commonConfig.DEPRECATED_VERSIONS
                const currentVersion = app.getVersion()

                let isDeprecatedVersion = false
                try {
                    if (semver.valid(currentVersion)) {
                        isDeprecatedVersion = semver.satisfies(currentVersion, deprecatedRange)
                    } else {
                        const coerced = semver.coerce(currentVersion)
                        isDeprecatedVersion = semver.satisfies(coerced?.version || '0.0.0', deprecatedRange)
                    }
                } catch (e) {
                    logger.updater.error('Failed to evaluate DEPRECATED_VERSIONS range', e)
                }

                if (isDeprecatedVersion) {
                    logger.updater.log('This version is deprecated', currentVersion, deprecatedRange)
                    this.install()
                    return
                }
            }

            this.safeSend(Events.DOWNLOAD_UPDATE_FINISHED)
            this.safeFlashFrame(true)
            this.safeSend(Events.UPDATE_APP_DATA, { update: true })
            this.safeSend(Events.UPDATE_AVAILABLE, this.latestAvailableVersion)

            this.onUpdateListeners.forEach(listener => listener(updateInfo.version))
        })
    }

    private safeSend(channel: string, payload?: any) {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.webContents.send(channel as any, payload)
        } catch (e) {
            logger.updater.error('safeSend error', e)
        }
    }

    private safeSetProgressBar(value: number) {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.setProgressBar(value)
        } catch (e) {
            logger.updater.error('safeSetProgressBar error', e)
        }
    }

    private safeFlashFrame(flag: boolean) {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return
            mainWindow.flashFrame(flag)
        } catch (e) {
            logger.updater.error('safeFlashFrame error', e)
        }
    }

    private applyCommonConfig(commonConfig: Record<string, any>) {
        logger.updater.info('Common config', commonConfig)
        for (const key in commonConfig) {
            if (Object.prototype.hasOwnProperty.call(commonConfig, key)) {
                this.commonConfig[key] = commonConfig[key]
                logger.updater.info(`Updated commonConfig: ${key} = ${commonConfig[key]}`)
            }
        }
    }

    private updateApplier(updateResult: ExtendedUpdateCheckResult | null) {
        if (!updateResult) {
            this.safeSend(Events.CHECK_UPDATE, { updateAvailable: false })
            return
        }

        const { downloadPromise, updateInfo } = updateResult

        if (updateInfo?.updateUrgency !== undefined) {
            logger.updater.info('Urgency', updateInfo.updateUrgency)
        }

        if (updateInfo?.commonConfig !== undefined) {
            this.applyCommonConfig(updateInfo.commonConfig)
        }

        this.latestAvailableVersion = updateInfo?.version || this.latestAvailableVersion
        this.safeSend(Events.CHECK_UPDATE, { updateAvailable: true })

        logger.updater.info('New version available', app.getVersion(), '->', updateInfo.version)

        this.updateStatus = UpdateStatus.DOWNLOADING

        if (downloadPromise) {
            downloadPromise.catch(error => {
                this.updateStatus = UpdateStatus.IDLE
                logger.updater.error('Downloader error', error)
                this.safeSetProgressBar(-1)
                this.safeSend(Events.DOWNLOAD_UPDATE_FAILED)
            })
            return
        }

        autoUpdater.downloadUpdate().catch(error => {
            this.updateStatus = UpdateStatus.IDLE
            logger.updater.error('downloadUpdate error', error)
            this.safeSetProgressBar(-1)
            this.safeSend(Events.DOWNLOAD_UPDATE_FAILED)
        })
    }

    async check(): Promise<UpdateStatus | null> {
        if (this.isDisposed) return this.updateStatus

        if (this.updateStatus !== UpdateStatus.IDLE) {
            logger.updater.log('New update is processing', this.updateStatus)
            if (this.updateStatus === UpdateStatus.DOWNLOADED) {
                this.safeSend(Events.UPDATE_AVAILABLE, this.latestAvailableVersion)
                this.safeFlashFrame(true)
            }
            return this.updateStatus
        }

        if (this.isChecking) {
            logger.updater.log('Check is already running, skipping')
            return this.updateStatus
        }

        this.isChecking = true
        try {
            const updateResult = (await autoUpdater.checkForUpdatesAndNotify({
                title: 'Новое обновление готово к установке',
                body: `PulseSync версия {version} успешно скачана и будет установлена автоматически при выходе из приложения`,
            })) as ExtendedUpdateCheckResult | null

            if (!updateResult) {
                logger.updater.log('Обновлений не найдено')
                this.safeSend(Events.CHECK_UPDATE, { updateAvailable: false })
                return null
            }

            this.updateApplier(updateResult)
        } catch (err: any) {
            const error = err as any

            if (error?.code === 'ENOENT' && typeof error?.path === 'string' && error.path.endsWith('app-update.yml')) {
                if (!isAppDev) {
                    logger.updater.error('File app-update.yml not found.', error)
                    dialog.showErrorBox('Ошибка', 'Файлы приложения повреждены. Переустановите приложение.')
                    app.quit()
                }
            } else {
                logger.updater.error('Error: checking for updates', error)
            }
        } finally {
            this.isChecking = false
        }

        return this.updateStatus
    }

    start(intervalMs: number = 900000) {
        this.stop()
        this.check()
        this.updaterId = setInterval(() => {
            this.check()
        }, intervalMs)
    }

    stop() {
        if (this.updaterId) {
            clearInterval(this.updaterId)
            this.updaterId = null
        }
    }

    onUpdate(listener: (version: string) => void) {
        this.onUpdateListeners.push(listener)
        return () => {
            this.onUpdateListeners = this.onUpdateListeners.filter(l => l !== listener)
        }
    }

    install() {
        logger.updater.info('Installing a new version', this.latestAvailableVersion)
        state.willQuit = true
        autoUpdater.quitAndInstall(true, true)
    }

    dispose() {
        this.isDisposed = true
        this.stop()
        try {
            autoUpdater.removeAllListeners('error')
            autoUpdater.removeAllListeners('checking-for-update')
            autoUpdater.removeAllListeners(Events.DOWNLOAD_PROGRESS)
            autoUpdater.removeAllListeners('update-not-available')
            autoUpdater.removeAllListeners('update-available')
            autoUpdater.removeAllListeners('update-downloaded')
        } catch (e) {
            logger.updater.error('dispose error', e)
        }
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
