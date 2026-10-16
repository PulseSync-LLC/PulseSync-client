import ElectronStoreModule from 'electron-store'

import { PULSESYNC_STORE_ENCRYPTION_KEY, PULSESYNC_STORE_NAME } from '../../shared/storageIdentity'

export function shouldHideStartupWindow(): boolean {
    try {
        const store = new ElectronStoreModule({
            name: PULSESYNC_STORE_NAME,
            encryptionKey: PULSESYNC_STORE_ENCRYPTION_KEY,
        })
        return store.get('settings.autoStartInTray', false) === true
    } catch (error) {
        console.warn('Failed to read startup visibility preference', error)
        return false
    }
}
