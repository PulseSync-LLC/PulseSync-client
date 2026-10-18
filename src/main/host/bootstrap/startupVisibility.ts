import ElectronStoreModule from 'electron-store'

import { shouldStartInTray } from '../../shared/startupVisibility'
import { PULSESYNC_STORE_ENCRYPTION_KEY, PULSESYNC_STORE_NAME } from '../../shared/storageIdentity'

export function shouldHideStartupWindow(): boolean {
    try {
        const store = new ElectronStoreModule({
            name: PULSESYNC_STORE_NAME,
            encryptionKey: PULSESYNC_STORE_ENCRYPTION_KEY,
        })
        return shouldStartInTray({
            autoStartInTray: store.get('settings.autoStartInTray', false) === true,
            openWindowOnManualLaunch: store.get('settings.openWindowOnManualLaunch', false) === true,
        })
    } catch (error) {
        console.warn('Failed to read startup visibility preference', error)
        return false
    }
}
