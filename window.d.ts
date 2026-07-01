import type { PulseSyncDesktopApi } from './src/common/desktopApi/contract'

declare global {
    interface Window {
        __listenersAdded?: boolean
        pulsesyncDesktop?: PulseSyncDesktopApi
    }
}
export {}
