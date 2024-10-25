import { contextBridge, ipcRenderer } from 'electron'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'

contextBridge.exposeInMainWorld('electron', {
    store: {
        get(key: string) {
            return ipcRenderer.sendSync('electron-store-get', key)
        },
        has(key: string): boolean {
            return ipcRenderer.sendSync('electron-store-has', key)
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
        close() {
            ipcRenderer.send('electron-window-close')
        },
        exit() {
            ipcRenderer.send('electron-window-exit')
        },
        isMac() {
            return ipcRenderer.sendSync('electron-mac')
        },
    },
    patcher: {
        patch: (val: boolean) => ipcRenderer.send('electron-patch', val),
        repatch: () => ipcRenderer.send('electron-repatch'),
        depatch: () => ipcRenderer.send('electron-depatch'),
    },
    musicDevice() {
        return ipcRenderer.sendSync('get-music-device')
    },
    corsAnywherePort() {
        return ipcRenderer.sendSync('electron-corsanywhereport')
    },
    downloadTrack(url: any) {
        ipcRenderer.send('download-track', url)
    },
    pathAppOpen: () => ipcRenderer.send('pathAppOpen'),
    pathStyleOpen: () => ipcRenderer.send('pathStyleOpen'),
    checkSelectedStyle: () => ipcRenderer.send('checkSelectedStyle'),
    selectStyle: (name: any, author: any) =>
        ipcRenderer.send('selectStyle', name, author),
    getThemesList: () => ipcRenderer.send('getThemesList'),
    checkFileExists: () => ipcRenderer.send('checkFileExists'),
    getVersion: () => ipcRenderer.send('getVersion'),
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
contextBridge.exposeInMainWorld('desktopEvents', {
    send(name: any, ...args: any[]) {
        ipcRenderer.send(name, ...args)
    },
    on(
        name: string,
        listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void,
    ) {
        ipcRenderer.on(name, listener)
    },
    once(channel: string, func: any) {
        ipcRenderer.once(channel, (event, args) => func(args))
    },
    removeListener(
        name: string,
        listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void,
    ) {
        ipcRenderer.removeListener(name, listener)
    },
    removeAllListeners: (channel: string) => {
        ipcRenderer.removeAllListeners(channel)
    },
    invoke(name: string, ...args: any[]) {
        return ipcRenderer.invoke(name, ...args)
    },
})
