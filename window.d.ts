import type { PulseSyncDesktopApi } from './src/common/desktopApi/contract'
import type { BootstrapWindowApi } from './src/common/types/bootstrapEvents'

declare global {
    interface Window {
        __listenersAdded?: boolean
        pulsesyncBootstrap?: BootstrapWindowApi
        pulsesyncDesktop?: PulseSyncDesktopApi
    }
}
export {}
