import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import packageJson from '../../package.json'
import MainEvents from '../common/types/mainEvents'

export interface DesktopEvents {
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
    },
    settings: {
        minimize() {
            ipcRenderer.send(MainEvents.ELECTRON_SETTINGS_MINIMIZE)
        },
        maximize() {
            ipcRenderer.send(MainEvents.ELECTRON_SETTINGS_MAXIMIZE)
        },
        close(val: boolean) {
            ipcRenderer.send(MainEvents.ELECTRON_SETTINGS_CLOSE, val)
        },
        exit() {
            ipcRenderer.send(MainEvents.ELECTRON_SETTINGS_EXIT)
        },
    },
    corsAnywherePort() {
        return ipcRenderer.sendSync(MainEvents.ELECTRON_CORSANYWHEREPORT)
    },
    isAppDev() {
        return ipcRenderer.sendSync(MainEvents.ELECTRON_ISDEV)
    },
    isLinux() {
        return ipcRenderer.sendSync('electron-islinux')
    },
    isMac() {
        return ipcRenderer.sendSync(MainEvents.ELECTRON_ISMAC)
    },
})
contextBridge.exposeInMainWorld('appInfo', {
    getBranch: () => ipcRenderer.sendSync(MainEvents.GET_LAST_BRANCH),
    getVersion: () => packageJson.version,
})
contextBridge.exposeInMainWorld('discordRpc', {
    async setActivity(presence: SetActivity) {
        ipcRenderer.send(MainEvents.DISCORDRPC_SETSTATE, presence)
    },
    async clearActivity() {
        ipcRenderer.send(MainEvents.DISCORDRPC_CLEARSTATE)
    },
    async discordRpc(val: boolean) {
        ipcRenderer.send(MainEvents.DISCORDRPC_DISCORDRPC, val)
    },
})
const desktopEvents: DesktopEvents = {
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
