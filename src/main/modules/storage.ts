import { ipcMain } from 'electron'
import logger from './logger'

let store: any

async function initializeStore() {
    try {
        const ElectronStoreModule = await import('electron-store')
        const ElectronStore = ElectronStoreModule.default
        store = new ElectronStore()

        ipcMain.on('electron-store-get', (event, val) => {
            event.returnValue = store.get(val)
        })

        ipcMain.on('electron-store-set', (event, key, val) => {
            store.set(key, val)
        })

        ipcMain.on('electron-store-delete', (event, key) => {
            store.delete(key)
        })

        ipcMain.on('electron-store-has', (event, key) => {
            event.returnValue = store.has(key)
        })

        logger.main.info('ElectronStore initialized and IPC handlers set up')
    } catch (error) {
        logger.main.error('Error initializing ElectronStore:', error)
    }
}

export { store, initializeStore }
