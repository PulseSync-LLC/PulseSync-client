import type { PulseSyncDesktopApi } from '@common/desktopApi/contract'
import type { BootstrapWindowApi } from '@common/types/bootstrapEvents'

declare global {
    interface Window {
        __listenersAdded?: boolean
        pulsesyncBootstrap?: BootstrapWindowApi
        pulsesyncDesktop?: PulseSyncDesktopApi
    }
}
export {}
