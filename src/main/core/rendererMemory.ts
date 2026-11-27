import { markUiNotReady } from './uiReady'

import type { BrowserWindow } from 'electron'

const RENDERER_IDLE_TIMEOUT_MS = 60_000

let suspended = false
let unloading: Promise<void> | undefined
let restoring: Promise<void> | undefined
let timer: NodeJS.Timeout | undefined
let window: BrowserWindow | undefined
let savedHash = ''
let restoreRenderer: ((hash: string) => Promise<void>) | undefined
let canSuspend: () => boolean = () => false

export const isRendererSuspended = (): boolean => suspended

export function scheduleRendererSuspension(): void {
    clearTimeout(timer)
    if (!window || window.isDestroyed() || window.isVisible() || suspended) return
    timer = setTimeout(() => {
        timer = undefined
        const target = window
        if (!target || target.isDestroyed() || target.isVisible() || suspended) return
        if (!canSuspend() || target.webContents.isDevToolsOpened() || target.webContents.isLoading()) {
            scheduleRendererSuspension()
            return
        }
        savedHash = new URL(target.webContents.getURL()).hash
        suspended = true
        markUiNotReady()
        unloading = target
            .loadURL('about:blank')
            .then(() => {
                if (!target.isDestroyed()) target.webContents.navigationHistory.clear()
            })
            .catch(error => {
                console.warn('Could not suspend the hidden renderer:', error)
            })
            .finally(() => {
                unloading = undefined
            })
    }, RENDERER_IDLE_TIMEOUT_MS)
    timer.unref()
}

export function ensureRendererLoaded(hash?: string): Promise<void> {
    clearTimeout(timer)
    if (hash && suspended) savedHash = hash
    const restore = restoreRenderer
    if (!suspended || !restore) return Promise.resolve()

    restoring ??= (async () => {
        await unloading
        await restore(savedHash)
        suspended = false
    })().finally(() => {
        restoring = undefined
    })
    return restoring
}

export function configureRendererMemory(target: BrowserWindow, options: { canSuspend(): boolean; restore(hash: string): Promise<void> }): void {
    window = target
    restoreRenderer = options.restore
    canSuspend = options.canSuspend
    target.on('hide', scheduleRendererSuspension)
    target.on('show', () => {
        void ensureRendererLoaded().catch(error => console.warn('Could not restore the renderer:', error))
    })
    target.once('closed', () => {
        clearTimeout(timer)
    })
}
