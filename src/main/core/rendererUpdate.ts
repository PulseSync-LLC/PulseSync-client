import RendererEvents from '@common/types/rendererEvents'

import logger from '../shared/logger'
import { isRendererSuspended } from './rendererMemory'
import { type MainRendererSource, resolveMainRendererSource } from './rendererSource'
import { canInstallIdleUpdate } from './updater/idleUpdate'

import type { BrowserWindow } from 'electron'

const RENDERER_UPDATE_INTERVAL_MS = 60 * 60 * 1000

type RendererUpdateControllerOptions = {
    activate(source: MainRendererSource): Promise<boolean | void>
    getActiveSource(): MainRendererSource | null
    window: BrowserWindow
}

function isSameRendererSource(left: MainRendererSource | null, right: MainRendererSource): boolean {
    return Boolean(left && left.manifest.buildNumber === right.manifest.buildNumber && left.url === right.url)
}

class RendererUpdateController {
    private options: RendererUpdateControllerOptions | null = null
    private pendingSource: MainRendererSource | null = null
    private timer: NodeJS.Timeout | null = null
    private checkInFlight = false
    private installInFlight = false

    public start(options: RendererUpdateControllerOptions): void {
        this.stop()
        this.options = options
        this.scheduleNextCheck()
    }

    public stop(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.pendingSource = null
        this.options = null
        this.checkInFlight = false
    }

    public async check(): Promise<boolean> {
        const options = this.options
        if (!options || options.window.isDestroyed() || this.checkInFlight) return false

        this.checkInFlight = true
        try {
            const nextSource = await resolveMainRendererSource()
            if (this.options !== options || options.window.isDestroyed()) return false
            const activeSource = options.getActiveSource()
            if (!activeSource || isSameRendererSource(activeSource, nextSource)) {
                if (this.pendingSource) options.window.flashFrame(false)
                this.pendingSource = null
                return false
            }

            const alreadyNotified = isSameRendererSource(this.pendingSource, nextSource)
            this.pendingSource = nextSource
            if (!alreadyNotified) {
                this.notifyAvailable(nextSource)
                logger.main.info('Renderer update available', {
                    currentBuildNumber: activeSource.manifest.buildNumber,
                    nextBuildNumber: nextSource.manifest.buildNumber,
                })
            }
            return true
        } catch (error) {
            logger.main.warn('Renderer update check failed', error)
            return false
        } finally {
            if (this.options === options) this.checkInFlight = false
        }
    }

    public async install(automatic = false): Promise<boolean> {
        const options = this.options
        if (!options || options.window.isDestroyed() || !this.pendingSource || this.installInFlight || isRendererSuspended()) return false

        this.installInFlight = true
        try {
            if (automatic && !(await canInstallIdleUpdate())) return false
            const latestSource = await resolveMainRendererSource()
            if (this.options !== options || options.window.isDestroyed()) return false
            if (isSameRendererSource(options.getActiveSource(), latestSource)) {
                this.pendingSource = null
                options.window.flashFrame(false)
                return false
            }

            if (automatic && !(await canInstallIdleUpdate())) return false
            if (this.options !== options || options.window.isDestroyed()) return false
            if ((await options.activate(latestSource)) === false) return false
            if (this.options !== options || options.window.isDestroyed()) return true
            this.pendingSource = null
            options.window.flashFrame(false)
            logger.main.info('Renderer update applied', { buildNumber: latestSource.manifest.buildNumber })
            return true
        } catch (error) {
            if (this.options !== options || options.window.isDestroyed()) return false
            logger.main.error('Failed to apply renderer update', error)
            if (this.pendingSource) this.notifyAvailable(this.pendingSource)
            return false
        } finally {
            this.installInFlight = false
        }
    }

    public publishStatus(): void {
        if (this.pendingSource) this.notifyAvailable(this.pendingSource)
    }

    private notifyAvailable(source: MainRendererSource): void {
        const options = this.options
        if (!options || options.window.isDestroyed()) return
        options.window.webContents.send(RendererEvents.UPDATE_AVAILABLE, {
            kind: 'renderer',
            version: source.manifest.buildNumber,
        })
        options.window.flashFrame(!options.window.isFocused())
    }

    private scheduleNextCheck(): void {
        const options = this.options
        if (!options || options.window.isDestroyed()) return
        this.timer = setTimeout(() => {
            if (this.options !== options) return
            this.timer = null
            void this.check().finally(() => {
                if (this.options === options) this.scheduleNextCheck()
            })
        }, RENDERER_UPDATE_INTERVAL_MS)
        this.timer.unref()
    }
}

const rendererUpdateController = new RendererUpdateController()

export const startRendererUpdateMonitor = (options: RendererUpdateControllerOptions): void => rendererUpdateController.start(options)
export const stopRendererUpdateMonitor = (): void => rendererUpdateController.stop()
export const checkRendererUpdate = (): Promise<boolean> => rendererUpdateController.check()
export const publishRendererUpdateStatus = (): void => rendererUpdateController.publishStatus()
export const installRendererUpdate = (automatic = false): Promise<boolean> => rendererUpdateController.install(automatic)
