import { AxiosRequestConfig, AxiosResponse } from 'axios'
import { Track } from './src/renderer/api/interfaces/track.interface'

interface DesktopEvents {
    emit(channel: string, ...args: any[]): void
    send(channel: string, ...args: any[]): void
    on(channel: string, listener: (event: any, ...args: any[]) => void): () => void
    once(channel: string, listener: (event: any, ...args: any[]) => void): void
    removeListener(channel: string, listener: (event: any, ...args: any[]) => void): void
    removeAllListeners(channel: string): void
    invoke(channel: string, ...args: any[]): Promise<any>
}

declare global {
    interface Window {
        __listenersAdded?: boolean
        electron: {
            store: {
                get: (key: string) => any
                set: (key: string, val: any) => void
                delete: (key: string) => void
            }
            window: {
                maximize: () => void
                minimize: () => void
                close: (val: boolean) => void
                exit: () => void
                isMaximized: () => Promise<boolean>
            }
            player: {
                setTrack: (track: Track, currentPercent: number) => void
                setPlaying: (value: boolean) => void
            }
            request: (url: string, config: AxiosRequestConfig) => AxiosResponse
            authorize: () => string
            version: () => string
            receive: (channel: string, func: (event: any, ...arg: any[]) => void) => void
            receiveOnce: (channel: string, func: (event: any, ...arg: any[]) => void) => void
            removeListener: (channel: string) => void
            isAppDev: () => boolean
            isLinux: () => boolean
            isMac: () => boolean
        }
        refreshAddons: () => void
        getModInfo: (args?: any, options?: { manual?: boolean; silentNotInstalled?: boolean }) => void
        desktopEvents: DesktopEvents
        appInfo: {
            getBranch: () => string
            getVersion: () => string
        }
    }
}
export {}
