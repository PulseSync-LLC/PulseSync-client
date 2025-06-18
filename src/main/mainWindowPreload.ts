import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'
import packageJson from '../../package.json'

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
            return ipcRenderer.sendSync('electron-store-get', key)
        },
        set(property: string, val: any) {
            ipcRenderer.send('electron-store-set', property, val)
        },
        delete(property: string) {
            ipcRenderer.send('electron-store-delete', property)
        },
    },
    window: {
        minimize() {
            ipcRenderer.send('electron-window-minimize')
        },
        maximize() {
            ipcRenderer.send('electron-window-maximize')
        },
        close(val: boolean) {
            ipcRenderer.send('electron-window-close', val)
        },
        exit() {
            ipcRenderer.send('electron-window-exit')
        },
        isMac() {
            return ipcRenderer.sendSync('electron-mac')
        },
    },
    corsAnywherePort() {
        return ipcRenderer.sendSync('electron-corsanywhereport')
    },
    isAppDev() {
        return ipcRenderer.sendSync('electron-isdev')
    },
})
contextBridge.exposeInMainWorld('appInfo', {
    getBranch: () => ipcRenderer.sendSync('getLastBranch'),
    getVersion: () => packageJson.version,
})
contextBridge.exposeInMainWorld('discordRpc', {
    async setActivity(presence: SetActivity) {
        ipcRenderer.send('discordrpc-setstate', presence)
    },
    async clearActivity() {
        ipcRenderer.send('discordrpc-clearstate')
    },
    async discordRpc(val: boolean) {
        ipcRenderer.send('discordrpc-discordRpc', val)
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
