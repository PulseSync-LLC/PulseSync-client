import { AxiosRequestConfig, AxiosResponse } from 'axios'
import { Track } from 'yandex-music-client'
import { Electron, ipcRenderer } from 'electron'
import { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser'

declare global {
    interface Window {
        electron: {
            store: {
                get: (key: string) => any
                has: (key: string) => string
                set: (key: string, val: any) => void
                delete: (key: string) => void
            }
            window: {
                maximize: () => void
                minimize: () => void
                close: () => void
                exit: () => void
                isMac: () => boolean
            }
            player: {
                setTrack: (track: Track, currentPercent: number) => void
                setPlaying: (value: boolean) => void
            }
            patcher: {
                patch: () => void
                repatch: () => void
                depatch: () => void
            }

            request: (url: string, config: AxiosRequestConfig) => AxiosResponse
            corsAnywherePort: () => number
            musicDevice: () => string
            authorize: () => string
            version: () => string
            downloadTrack: (data: any) => void
            receive: (
                channel: string,
                func: (event: any, ...arg: any[]) => void,
            ) => void
            receiveOnce: (
                channel: string,
                func: (event: any, ...arg: any[]) => void,
            ) => void
            removeListener: (channel: string) => void
            getVersion: (version: string) => string
        }
        discordRpc: {
            discordRpc: (val: boolean) => void
            setActivity: (props: SetActivity) => void
            clearActivity: () => void
        }
        desktopEvents: {
            send: (name: any, ...args: any[]) => void
            on: (
                name: string,
                listener: (
                    event: Electron.IpcRendererEvent,
                    ...args: any[]
                ) => void,
            ) => void
            once: (
                channel: string,
                func: (event: any, ...arg: any[]) => void,
            ) => void
            removeListener: (
                name: string,
                listener: (
                    event: Electron.IpcRendererEvent,
                    ...args: any[]
                ) => void,
            ) => void
            removeAllListeners: (channel: string) => void
            invoke: (name: string, ...args: any[]) => Promise<any>
        }
    }
}

export {}
