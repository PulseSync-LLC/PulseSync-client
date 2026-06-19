import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import packageJson from '../../package.json'
import MainEvents from '../common/types/mainEvents'
import type { ClientBuildIdentity } from '@common/types/clientBuildIdentity'
import type { ClientHardwareIdentity } from '@common/types/clientHardwareIdentity'

const buildPackageJson = packageJson as typeof packageJson & {
    buildInfo?: {
        VERSION?: string
        BRANCH?: string
        BUILD_TIME?: string
        SIGNATURE?: string
    }
}

export interface DesktopEvents {
    emit(channel: string, ...args: any[]): void
    send(channel: string, ...args: any[]): void
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): () => void
    once(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void
    removeListener(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void
    removeAllListeners(channel: string): void
    invoke(channel: string, ...args: any[]): Promise<any>
}

contextBridge.exposeInMainWorld('electron', {
    store: {
        get(key: string) {
            return ipcRenderer.sendSync(MainEvents.ELECTRON_STORE_GET, key)
        },
        set(property: string, val: any) {
            ipcRenderer.send(MainEvents.ELECTRON_STORE_SET, property, val)
        },
        delete(property: string) {
            ipcRenderer.send(MainEvents.ELECTRON_STORE_DELETE, property)
        },
    },
    window: {
        minimize() {
            ipcRenderer.send(MainEvents.ELECTRON_WINDOW_MINIMIZE)
        },
        maximize() {
            ipcRenderer.send(MainEvents.ELECTRON_WINDOW_MAXIMIZE)
        },
        close(val: boolean) {
            ipcRenderer.send(MainEvents.ELECTRON_WINDOW_CLOSE, val)
        },
        exit() {
            ipcRenderer.send(MainEvents.ELECTRON_WINDOW_EXIT)
        },
        isMaximized() {
            return ipcRenderer.invoke(MainEvents.ELECTRON_WINDOW_IS_MAXIMIZED)
        }
    },
    isAppDev() {
        return ipcRenderer.sendSync(MainEvents.ELECTRON_ISDEV)
    },
    isLinux() {
        return ipcRenderer.sendSync(MainEvents.ELECTRON_ISLINUX)
    },
    isMac() {
        return ipcRenderer.sendSync(MainEvents.ELECTRON_ISMAC)
    },
})
contextBridge.exposeInMainWorld('appInfo', {
    getBranch: () => ipcRenderer.sendSync(MainEvents.GET_LAST_BRANCH),
    getVersion: () => buildPackageJson.version,
    getHardwareIdentity: (): ClientHardwareIdentity | null => {
        try {
            return ipcRenderer.sendSync(MainEvents.GET_CLIENT_HARDWARE_IDENTITY) ?? null
        } catch {
            return null
        }
    },
    getBuildIdentity: (): ClientBuildIdentity => ({
        origin: 'PulseSync-LLC/PulseSync-client',
        version: buildPackageJson.buildInfo?.VERSION || buildPackageJson.version,
        commit: buildPackageJson.buildInfo?.BRANCH || 'unknown',
        builtAt: buildPackageJson.buildInfo?.BUILD_TIME || '',
        signatureAlgorithm: 'ed25519',
        signature: buildPackageJson.buildInfo?.SIGNATURE || '',
    }),
})
const desktopEvents: DesktopEvents = {
    emit: (channel, ...args) => {
        ipcRenderer.emit(channel as string, ...args)
    },
    send: (channel, ...args) => {
        ipcRenderer.send(channel as string, ...args)
    },
    on: (channel, listener) => {
        const wrapped = (event: IpcRendererEvent, ...args: any[]) => listener(event, ...args)
        ipcRenderer.on(channel as string, wrapped)
        return () => {
            ipcRenderer.off(channel as string, wrapped)
        }
    },
    once: (channel, listener) => {
        ipcRenderer.once(channel as string, listener)
    },
    removeListener: (channel, listener) => {
        ipcRenderer.removeListener(channel as string, listener)
    },
    removeAllListeners: channel => {
        ipcRenderer.removeAllListeners(channel as string)
    },
    invoke: (channel, ...args) => {
        return ipcRenderer.invoke(channel as string, ...args)
    },
}
contextBridge.exposeInMainWorld('desktopEvents', desktopEvents)
