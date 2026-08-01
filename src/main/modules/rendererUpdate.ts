import type { BrowserWindow } from 'electron'
import RendererEvents from '@common/types/rendererEvents'
import logger from './logger'
import { resolveMainRendererSource, type MainRendererSource } from './rendererSource'

const RENDERER_UPDATE_INTERVAL_MS = 60 * 60 * 1000

type RendererUpdateControllerOptions = {
    activate(source: MainRendererSource): Promise<void>
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
            const activeSource = options.getActiveSource()
            const nextSource = await resolveMainRendererSource()
            if (!activeSource || isSameRendererSource(activeSource, nextSource)) {
                this.pendingSource = null
                return false
            }

            this.pendingSource = nextSource
            this.notifyAvailable(nextSource)
            logger.main.info('Renderer update available', {
                currentBuildNumber: activeSource.manifest.buildNumber,
                nextBuildNumber: nextSource.manifest.buildNumber,
            })
            return true
        } catch (error) {
            logger.main.warn('Renderer update check failed', error)
            return false
        } finally {
            this.checkInFlight = false
        }
    }

    public async install(): Promise<boolean> {
        const options = this.options
        if (!options || options.window.isDestroyed() || !this.pendingSource) return false

        try {
            const latestSource = await resolveMainRendererSource()
            if (isSameRendererSource(options.getActiveSource(), latestSource)) {
                this.pendingSource = null
                options.window.flashFrame(false)
                return false
            }

            await options.activate(latestSource)
            this.pendingSource = null
            options.window.flashFrame(false)
            logger.main.info('Renderer update applied', { buildNumber: latestSource.manifest.buildNumber })
            return true
        } catch (error) {
            logger.main.error('Failed to apply renderer update', error)
            if (this.pendingSource) this.notifyAvailable(this.pendingSource)
            return false
        }
    }

    private notifyAvailable(source: MainRendererSource): void {
        const options = this.options
        if (!options || options.window.isDestroyed()) return
        options.window.webContents.send(RendererEvents.UPDATE_AVAILABLE, {
            kind: 'renderer',
            version: source.manifest.buildNumber,
        })
        options.window.flashFrame(true)
    }

    private scheduleNextCheck(): void {
        this.timer = setTimeout(() => {
            this.timer = null
            void this.check().finally(() => {
                if (this.options) this.scheduleNextCheck()
            })
        }, RENDERER_UPDATE_INTERVAL_MS)
        this.timer.unref()
    }
}

const rendererUpdateController = new RendererUpdateController()

export const startRendererUpdateMonitor = (options: RendererUpdateControllerOptions): void => rendererUpdateController.start(options)
export const stopRendererUpdateMonitor = (): void => rendererUpdateController.stop()
export const checkRendererUpdate = (): Promise<boolean> => rendererUpdateController.check()
export const installRendererUpdate = (): Promise<boolean> => rendererUpdateController.install()
