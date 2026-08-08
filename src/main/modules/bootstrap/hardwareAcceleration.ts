import { app } from 'electron'
import ElectronStoreModule from 'electron-store'
import { PULSESYNC_STORE_ENCRYPTION_KEY, PULSESYNC_STORE_NAME } from '../storageIdentity'

const ElectronStore = ElectronStoreModule

export function applyHardwareAccelerationPreference(): void {
    try {
        const store = new ElectronStore({
            name: PULSESYNC_STORE_NAME,
            encryptionKey: PULSESYNC_STORE_ENCRYPTION_KEY,
        })
        if (store.get('settings.hardwareAcceleration', true) === false) {
            app.disableHardwareAcceleration()
        }
    } catch (error) {
        console.warn('Failed to apply hardware acceleration preference during bootstrap', error)
    }
}
