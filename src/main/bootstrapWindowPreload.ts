import { contextBridge, ipcRenderer } from 'electron'

import { BOOTSTRAP_WINDOW_CHANNELS, type BootstrapUiStateV1, type BootstrapWindowApi, isBootstrapUiStateV1 } from '@common/types/bootstrapEvents'

const api: BootstrapWindowApi = {
    ready: () => ipcRenderer.send(BOOTSTRAP_WINDOW_CHANNELS.ready),
    retry: async () => (await ipcRenderer.invoke(BOOTSTRAP_WINDOW_CHANNELS.retry)) === true,
    continue: async () => (await ipcRenderer.invoke(BOOTSTRAP_WINDOW_CHANNELS.continue)) === true,
    onState: listener => {
        const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
            if (isBootstrapUiStateV1(value)) {
                listener(value)
            }
        }
        ipcRenderer.on(BOOTSTRAP_WINDOW_CHANNELS.state, handler)
        return () => ipcRenderer.removeListener(BOOTSTRAP_WINDOW_CHANNELS.state, handler)
    },
}

contextBridge.exposeInMainWorld('pulsesyncBootstrap', Object.freeze(api))
